import {
  LoadSceneResponseAgent,
  PreviousState,
} from '../../proto/ai/inworld/engine/world-engine.pb';
import {
  ClientRequest,
  LoadSceneResponse,
} from '../../proto/ai/inworld/engine/world-engine.pb';
import { DEFAULT_SESSION_STATE_KEY } from '../common/constants';
import {
  AudioSessionState,
  Awaitable,
  CancelResponses,
  CancelResponsesProps,
  ConnectionState,
  Extension,
  GenerateSessionTokenFn,
  InternalClientConfiguration,
  InworldError,
  SendPacketParams,
  TtsPlaybackAction,
  User,
} from '../common/data_structures';
import {
  CHAT_HISTORY_TYPE,
  HistoryItem,
  InworldHistory,
} from '../components/history';
import { GrpcAudioPlayback } from '../components/sound/grpc_audio.playback';
import { GrpcWebRtcLoopbackBiDiSession } from '../components/sound/grpc_web_rtc_loopback_bidi.session';
import { Player } from '../components/sound/player';
import {
  Connection,
  QueueItem,
  WebSocketConnection,
} from '../connection/web-socket.connection';
import { Character } from '../entities/character.entity';
import { SessionContinuation } from '../entities/continuation/session_continuation.entity';
import { InworldPacket } from '../entities/inworld_packet.entity';
import { SessionToken } from '../entities/session_token.entity';
import { EventFactory } from '../factories/event';
import { InworldPacket as ProtoPacket } from './../../proto/ai/inworld/packets/packets.pb';
import {
  SessionState,
  StateSerializationService,
} from './pb/state_serialization.service';
import { WorldEngineService } from './pb/world_engine.service';

interface ConnectionProps<InworldPacketT, HistoryItemT> {
  name?: string;
  user?: User;
  client?: ClientRequest;
  config?: InternalClientConfiguration;
  sessionContinuation?: SessionContinuation;
  onReady?: () => Awaitable<void>;
  onError?: (err: InworldError) => Awaitable<void>;
  onMessage?: (packet: InworldPacketT) => Awaitable<void>;
  onDisconnect?: () => Awaitable<void>;
  onInterruption?: (props: CancelResponsesProps) => Awaitable<void>;
  onHistoryChange?: (
    history: HistoryItem[],
    diff: HistoryItem[],
  ) => Awaitable<void>;
  grpcAudioPlayer: GrpcAudioPlayback;
  webRtcLoopbackBiDiSession: GrpcWebRtcLoopbackBiDiSession;
  generateSessionToken: GenerateSessionTokenFn;
  extension?: Extension<InworldPacketT, HistoryItemT>;
}

// TODO: Use more appriopriate error checks
const sessionExpiredRegExp = new RegExp('Session (.*?) expired or invalid');
const invalidToken = 'invalid JWT token';

export class ConnectionService<
  InworldPacketT extends InworldPacket = InworldPacket,
  HistoryItemT extends HistoryItem = HistoryItem,
> {
  private player = Player.getInstance();
  private state: ConnectionState = ConnectionState.INACTIVE;
  private audioSessionAction = AudioSessionState.UNKNOWN;
  private audioSessionParams: SendPacketParams = {};
  private ttsPlaybackAction = TtsPlaybackAction.UNKNOWN;

  private scene: LoadSceneResponse;
  private session: SessionToken;
  private connection: Connection<InworldPacketT>;
  private connectionProps: ConnectionProps<InworldPacketT, HistoryItemT>;

  private characters: Array<Character> = [];

  private intervals: NodeJS.Timeout[] = [];
  private disconnectTimeoutId: NodeJS.Timeout;

  private eventFactory = new EventFactory();

  private stateService = new StateSerializationService();
  private engineService = new WorldEngineService<InworldPacketT>();

  onDisconnect: (() => Awaitable<void>) | undefined;
  onError: (err: InworldError) => Awaitable<void>;
  onMessage: ((packet: ProtoPacket) => Awaitable<void>) | undefined;
  onReady: (() => Awaitable<void>) | undefined;

  private cancelResponses: CancelResponses = {};
  private packetsInProgress: { [key: string]: () => ProtoPacket } = {};
  private history: InworldHistory;
  private extension: Extension<InworldPacketT, HistoryItemT>;

  constructor(props?: ConnectionProps<InworldPacketT, HistoryItemT>) {
    this.connectionProps =
      props || ({} as ConnectionProps<InworldPacketT, HistoryItemT>);
    this.history = new InworldHistory<InworldPacketT>({
      extension: this.connectionProps.extension,
      user: this.connectionProps.user,
    });

    this.initializeHandlers();
    this.initializeConnection();
    this.initializeExtension();
  }

  isActive() {
    return this.state === ConnectionState.ACTIVE;
  }

  isAutoReconnected() {
    return this.connectionProps.config?.connection?.autoReconnect ?? true;
  }

  async getSessionState() {
    try {
      const { config, name: scene } = this.connectionProps;
      const session = await this.ensureSessionToken();

      return this.stateService.getSessionState({
        config,
        scene,
        session,
      });
    } catch (err) {
      this.onError(err);
    }
  }

  async openManually() {
    try {
      if (this.isAutoReconnected()) {
        throw Error(
          'Impossible to open connection manually with `autoReconnect` enabled',
        );
      }

      if (this.state !== ConnectionState.INACTIVE) {
        throw Error('Connection is already open');
      }

      return this.open();
    } catch (err) {
      this.onError(err);
    }
  }

  close() {
    this.cancelScheduler();
    this.state = ConnectionState.INACTIVE;
    this.connection.close();
    this.clearQueue();
  }

  getHistory() {
    return this.history.get();
  }

  clearHistory() {
    this.history.clear();
  }

  getEventFactory() {
    return this.eventFactory;
  }

  getTranscript() {
    return this.history.getTranscript();
  }

  async loadCharacters() {
    await this.loadScene();
  }

  async open() {
    try {
      const packets = this.getPacketsToSentOnOpen();

      await this.loadScene();

      if (this.state === ConnectionState.LOADED) {
        this.state = ConnectionState.ACTIVATING;

        await this.connection.open({
          session: this.session,
          convertPacketFromProto: this.extension.convertPacketFromProto,
          ...(packets.length && { packets }),
        });

        this.scheduleDisconnect();
      }
    } catch (err) {
      this.onError(err);
    }
  }

  async send(getPacket: () => ProtoPacket) {
    try {
      this.cancelScheduler();

      if (!this.isActive() && !this.isAutoReconnected()) {
        throw Error('Unable to send data due inactive connection');
      }

      return this.write(getPacket);
    } catch (err) {
      this.onError(err);
    }
  }

  setAudioSessionAction(action: AudioSessionState) {
    this.audioSessionAction = action;
  }

  setAudioSessionParams(params: SendPacketParams = {}) {
    this.audioSessionParams = params;
  }

  getAudioSessionAction() {
    return this.audioSessionAction;
  }

  getAudioSessionParams() {
    return this.audioSessionParams;
  }

  setTtsPlaybackAction(action: TtsPlaybackAction) {
    this.ttsPlaybackAction = action;
  }

  getTtsPlaybackAction() {
    return this.ttsPlaybackAction;
  }

  async interrupt() {
    const packet =
      this.connectionProps.grpcAudioPlayer.getCurrentPacket() as InworldPacketT;

    if (packet) {
      await this.interruptByPacket(packet);
    }
  }

  private setCharacterList() {
    const characters = (this.scene?.agents || [])?.map(
      (agent: LoadSceneResponseAgent) =>
        new Character({
          id: agent.agentId,
          resourceName: agent.brainName,
          displayName: agent.givenName,
          assets: {
            avatarImg: agent.characterAssets.avatarImg,
            avatarImgOriginal: agent.characterAssets.avatarImgOriginal,
            rpmModelUri: agent.characterAssets.rpmModelUri,
            rpmImageUriPortrait: agent.characterAssets.rpmImageUriPortrait,
            rpmImageUriPosture: agent.characterAssets.rpmImageUriPosture,
          },
        }),
    );

    const factory = this.getEventFactory();

    if (
      !this.connectionProps.config.capabilities.multiAgent &&
      !factory.getCurrentCharacter() &&
      characters[0]
    ) {
      factory.setCurrentCharacter(characters[0]);
    }

    factory.setCharacters(characters);
  }

  private async write(getPacket: () => ProtoPacket) {
    let inworldPacket: InworldPacketT;

    const resolvePacket = () =>
      new Promise<InworldPacketT>((resolve) => {
        const interval = setInterval(() => {
          if (inworldPacket || this.state === ConnectionState.INACTIVE) {
            clearInterval(interval);

            this.intervals = this.intervals.filter(
              (i: NodeJS.Timeout) => i !== interval,
            );

            resolve(inworldPacket);
          }
        }, 10);
        this.intervals.push(interval);
      });

    // 1. Send a packet to a connection.
    // The packet will be sent directly or added to the queue.
    // If the connection is not active, we need to add the packet to the queue first to guarantee the order of packets.
    this.connection.write({
      getPacket,
      afterWriting: (packet: InworldPacketT) => {
        inworldPacket = packet;

        this.scheduleDisconnect();

        this.addPacketToHistory(inworldPacket);
      },
      beforeWriting: async (packet: InworldPacketT) => {
        if (packet.isText()) {
          await this.interruptByPacket(packet);
        }

        if (packet.isText() || packet.isAudio()) {
          this.packetsInProgress[packet.packetId.interactionId] = getPacket;
        }
      },
    });

    // 2. Open the connection if it's inactive.
    if (!this.isActive()) {
      this.open();
    }

    return resolvePacket();
  }

  private async loadScene() {
    if (this.state === ConnectionState.LOADING) return;

    const { name, client, user } = this.connectionProps;

    try {
      await this.ensureSessionToken({
        beforeLoading: () => {
          this.state = ConnectionState.LOADING;
        },
      });

      if (!this.scene) {
        const saved = localStorage.getItem(DEFAULT_SESSION_STATE_KEY);
        const sessionState = saved
          ? (JSON.parse(saved) as SessionState)
          : undefined;
        const sessionContinuation = sessionState?.state
          ? new SessionContinuation({ previousState: sessionState.state })
          : this.connectionProps.sessionContinuation;

        this.scene = await this.engineService.loadScene({
          config: this.connectionProps.config,
          session: this.session,
          sessionContinuation,
          extension: this.extension,
          name,
          user,
          client,
        });

        if (this.connectionProps?.config?.history?.previousState) {
          this.setPreviousState(this.scene?.previousState);
        }

        this.setCharacterList();
      }

      if (
        [ConnectionState.LOADING, ConnectionState.INACTIVE].includes(this.state)
      ) {
        this.state = ConnectionState.LOADED;
      }
    } catch (err) {
      this.onError(err);
    }
  }

  async ensureSessionToken(props?: { beforeLoading: () => void }) {
    // Generate new session token is it's empty or expired
    if (!this.session || SessionToken.isExpired(this.session)) {
      const { sessionId } = this.session || {};

      props?.beforeLoading?.();
      let sessionToken = await this.connectionProps.generateSessionToken();

      // Reuse session id to keep context of previous conversation
      if (sessionId) {
        sessionToken = {
          ...this.session,
          sessionId,
        };
      }

      this.session = sessionToken;
    }

    return this.session;
  }

  private scheduleDisconnect() {
    if (this.connectionProps.config?.connection?.disconnectTimeout) {
      this.cancelScheduler();
      this.disconnectTimeoutId = setTimeout(
        () => this.close(),
        this.connectionProps.config.connection.disconnectTimeout,
      );
    }
  }

  private setPreviousState(previousState: PreviousState) {
    const { stateHolders = [] } = previousState || {};
    stateHolders.forEach((stateHolder) => {
      stateHolder.packets?.forEach((packet) =>
        this.history.addOrUpdate({
          grpcAudioPlayer: this.connectionProps.grpcAudioPlayer,
          characters: this.eventFactory.getCharacters(),
          packet: this.extension.convertPacketFromProto(packet),
        }),
      );
    });

    const changed = this.history.get();

    if (changed.length) {
      this.connectionProps.onHistoryChange?.(changed, changed);
    }
  }

  private cancelScheduler() {
    if (this.disconnectTimeoutId) {
      clearTimeout(this.disconnectTimeoutId);
    }
  }

  private initializeHandlers() {
    const {
      onError,
      onReady,
      onDisconnect,
      grpcAudioPlayer,
      webRtcLoopbackBiDiSession,
    } = this.connectionProps;

    this.onReady = async () => {
      await webRtcLoopbackBiDiSession.startSession(
        new MediaStream(),
        grpcAudioPlayer.getPlaybackStream(),
      );
      this.player.setStream(
        webRtcLoopbackBiDiSession.getPlaybackLoopbackStream(),
      );
      this.state = ConnectionState.ACTIVE;
      onReady?.();
    };

    this.onDisconnect = async () => {
      this.state = ConnectionState.INACTIVE;
      this.audioSessionAction = AudioSessionState.UNKNOWN;
      await onDisconnect?.();
    };

    this.onError = async (err: InworldError) => {
      if (onError) {
        onError(err);
      } else {
        console.error(err);
      }

      const { message } = err;

      if (
        (sessionExpiredRegExp.test(message) || invalidToken === message) &&
        this.isAutoReconnected()
      ) {
        this.session = undefined;
        this.scene = undefined;
        this.state = ConnectionState.INACTIVE;

        await this.open();
      }
    };

    this.onMessage = async (packet: ProtoPacket) => {
      const { onMessage, grpcAudioPlayer } = this.connectionProps;

      const inworldPacket = this.extension.convertPacketFromProto(packet);
      const interactionId = inworldPacket.packetId.interactionId;

      // Delete packet from queue on interaction end.
      // It means that packet was successfully applied on the server side.
      if (inworldPacket.isInteractionEnd()) {
        delete this.packetsInProgress[interactionId];
      }

      // Don't pass text packet outside for interrupred interaction.
      if (
        inworldPacket.isText() &&
        !inworldPacket.routing.source.isPlayer &&
        this.cancelResponses[interactionId]
      ) {
        this.sendCancelResponses(
          {
            interactionId,
            utteranceId: [packet.packetId.utteranceId],
          },
          [
            {
              id: packet.routing.source.name,
            } as Character,
          ],
        );

        return;
      }

      // Send cancel response event in case of player talking.
      if (inworldPacket.isText() && inworldPacket.routing.source.isPlayer) {
        await this.interruptByPacket(inworldPacket);
      }

      // Play audio or silence.
      if (inworldPacket.isAudio() || inworldPacket.isSilence()) {
        if (!this.cancelResponses[interactionId]) {
          grpcAudioPlayer.addToQueue({
            packet: inworldPacket,
            onBeforePlaying: (packet: InworldPacketT) => {
              this.displayPlacketInHistory(packet, CHAT_HISTORY_TYPE.ACTOR);
              this.displayPlacketInHistory(
                packet,
                CHAT_HISTORY_TYPE.NARRATED_ACTION,
              );
            },
            onAfterPlaying: (packet: InworldPacketT) => {
              this.displayPlacketInHistory(
                packet,
                CHAT_HISTORY_TYPE.INTERACTION_END,
              );
            },
          });
        }
      }

      // Delete info about cancel responses on interaction end.
      if (inworldPacket.isInteractionEnd()) {
        delete this.cancelResponses[interactionId];
      }

      // Add packet to history.
      this.addPacketToHistory(inworldPacket);

      // Pass packet to external callback.
      onMessage?.(inworldPacket);
    };
  }

  hasPacketsInProgress() {
    return !!Object.keys(this.packetsInProgress).length;
  }

  private initializeConnection() {
    const { config } = this.connectionProps;

    const props = {
      config,
      onDisconnect: this.onDisconnect,
      onReady: this.onReady,
      onError: this.onError,
      onMessage: this.onMessage,
    };

    this.connection = new WebSocketConnection(props);
  }

  private initializeExtension() {
    const extension = this.connectionProps.extension ?? {};

    this.extension = {
      convertPacketFromProto: (proto: ProtoPacket) =>
        InworldPacket.fromProto(proto) as InworldPacketT,
      ...extension,
    };
  }

  private async interruptByPacket(packet: InworldPacketT) {
    const { grpcAudioPlayer, config } = this.connectionProps;

    if (!config?.capabilities.interruptions) return;

    const packets = await grpcAudioPlayer.stopForInteraction(
      packet.packetId.interactionId,
    );

    if (packets.length) {
      const interactionId = packets[0].packetId.interactionId;
      const characters = packets.map(
        (packet: InworldPacketT) =>
          ({
            id: packet.routing.source.name,
          } as Character),
      );

      this.sendCancelResponses(
        {
          interactionId,
          utteranceId: packets.map(
            (packet: InworldPacketT) => packet.packetId.utteranceId,
          ),
        },
        characters,
      );
    }
  }

  private sendCancelResponses(
    cancelResponses: CancelResponsesProps,
    characters?: Character[],
  ) {
    if (cancelResponses.interactionId) {
      this.send(() =>
        this.getEventFactory().cancelResponse(cancelResponses, characters),
      );

      this.cancelResponses = {
        ...this.cancelResponses,
        [cancelResponses.interactionId]: true,
      };

      const interruptionData = {
        utteranceId: cancelResponses.utteranceId ?? [],
        interactionId: cancelResponses.interactionId,
      };

      this.connectionProps.onInterruption?.(interruptionData);

      this.history.filter(interruptionData);
    }
  }

  private addPacketToHistory(packet: InworldPacketT) {
    const changed = this.history.addOrUpdate({
      grpcAudioPlayer: this.connectionProps.grpcAudioPlayer,
      characters: this.eventFactory.getCharacters(),
      packet,
    });

    if (changed.length) {
      this.connectionProps.onHistoryChange?.(this.getHistory(), changed);
    }
  }

  private displayPlacketInHistory(
    packet: InworldPacketT,
    type:
      | CHAT_HISTORY_TYPE.ACTOR
      | CHAT_HISTORY_TYPE.INTERACTION_END
      | CHAT_HISTORY_TYPE.NARRATED_ACTION,
  ) {
    const changed = this.history.display(packet, type);

    if (changed.length) {
      this.connectionProps.onHistoryChange?.(this.getHistory(), changed);
    }
  }

  private clearQueue() {
    this.intervals.forEach((i: NodeJS.Timeout) => {
      clearInterval(i);
    });

    this.intervals = [];
  }

  private getPacketsToSentOnOpen() {
    const packets: QueueItem<InworldPacketT>[] = [];

    if (this.isAutoReconnected()) {
      if (this.getTtsPlaybackAction() === TtsPlaybackAction.MUTE) {
        packets.push({
          getPacket: () => this.getEventFactory().ttsPlaybackMute(true),
        });
      }
    }

    if (this.state === ConnectionState.RECONNECTING) {
      const notAppliedPackets = { ...this.packetsInProgress };

      this.packetsInProgress = {};

      Object.keys(notAppliedPackets).forEach((interactionId) => {
        const getPacket = notAppliedPackets[interactionId];

        packets.push({
          getPacket,
          afterWriting: (packet: InworldPacketT) => {
            if (packet.isText() || packet.isAudio()) {
              this.packetsInProgress[packet.packetId.interactionId] = getPacket;
            }
          },
        });
      });
    }

    return packets;
  }
}
