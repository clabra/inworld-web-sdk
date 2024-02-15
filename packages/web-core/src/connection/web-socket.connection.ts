import { InworldPacket as ProtoPacket } from '../../proto/ai/inworld/packets/packets.pb';
import {
  Awaitable,
  InternalClientConfiguration,
  InworldError,
} from '../common/data_structures';
import { safeJSONParse } from '../common/helpers';
import { InworldPacket } from '../entities/inworld_packet.entity';
import { SessionToken } from '../entities/session_token.entity';

const SESSION_PATH = '/v1/session/default';

interface SessionProps {
  config: InternalClientConfiguration;
  session: SessionToken;
  onDisconnect?: () => Awaitable<void>;
  onError?: (err: Event | Error) => Awaitable<void>;
  onMessage?: (packet: ProtoPacket) => Awaitable<void>;
  onReady?: () => Awaitable<void>;
}
interface ConnectionProps {
  config?: InternalClientConfiguration;
  onDisconnect?: () => Awaitable<void>;
  onReady?: () => Awaitable<void>;
  onError?: (err: InworldError) => Awaitable<void>;
  onMessage?: (packet: ProtoPacket) => Awaitable<void>;
}

interface OpenConnectionProps<InworldPacketT> {
  session: SessionToken;
  convertPacketFromProto: (proto: ProtoPacket) => InworldPacketT;
  packets?: QueueItem<InworldPacketT>[];
}

export interface QueueItem<InworldPacketT> {
  getPacket: () => ProtoPacket;
  afterWriting?: (packet: InworldPacketT) => void;
  beforeWriting?: (packet: InworldPacketT) => Promise<void>;
}

export interface Connection<InworldPacketT> {
  close(): void;
  isActive: () => boolean;
  open(props: OpenConnectionProps<InworldPacketT>): Promise<void>;
  write(item: QueueItem<InworldPacketT>): void;
}

export class WebSocketConnection<
  InworldPacketT extends InworldPacket = InworldPacket,
> implements Connection<InworldPacketT>
{
  private connectionProps: ConnectionProps;
  private ws: WebSocket;
  private packetQueue: QueueItem<InworldPacketT>[] = [];
  private convertPacketFromProto: (proto: ProtoPacket) => InworldPacketT;

  constructor(props: ConnectionProps) {
    this.connectionProps = props;
  }

  isActive() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async open({
    session,
    packets,
    convertPacketFromProto,
  }: OpenConnectionProps<InworldPacketT>) {
    const { config } = this.connectionProps;

    if (packets?.length) {
      this.packetQueue = [...packets, ...this.packetQueue];
    }

    this.convertPacketFromProto = convertPacketFromProto;
    this.ws = this.createWebSocket({
      config,
      session,
    });
  }

  close() {
    this.ws?.removeEventListener('error', this.onError);
    this.ws?.removeEventListener('close', this.connectionProps.onDisconnect);
    this.ws?.removeEventListener('open', this.onReady);
    this.ws?.removeEventListener('message', this.onMessage);

    if (this.isActive()) {
      this.ws.close();
      this.connectionProps.onDisconnect();
    }

    this.ws = null;
    this.packetQueue = [];
  }

  async write(item: QueueItem<InworldPacketT>) {
    // There's time gap between connection creation and connection activation.
    // So put packets to queue and send them `onReady` event.
    if (this.isActive()) {
      const packet = item.getPacket();
      const inworldPacket = this.convertPacketFromProto(packet);
      await item.beforeWriting?.(inworldPacket);
      this.ws.send(JSON.stringify(packet));
      item.afterWriting?.(inworldPacket);
    } else {
      this.packetQueue.push(item);
    }
  }

  private createWebSocket(props: SessionProps) {
    const { config, session } = props;
    const { hostname, ssl } = config.connection.gateway;

    const url = `${
      ssl ? 'wss' : 'ws'
    }://${hostname}${SESSION_PATH}?session_id=${session.sessionId}`;

    const ws = new WebSocket(url, [session.type, session.token]);

    ws.addEventListener('open', this.onReady.bind(this));
    ws.addEventListener('message', this.onMessage.bind(this));
    ws.addEventListener('error', this.onError.bind(this));
    ws.addEventListener('close', this.connectionProps.onDisconnect);

    return ws;
  }

  private onMessage(event: MessageEvent) {
    const payload = safeJSONParse(event.data);

    if (payload.error) {
      this.connectionProps.onError(payload.error as InworldError);
    } else {
      this.connectionProps.onMessage(payload.result as ProtoPacket);
    }
  }

  private onReady() {
    setTimeout(() => {
      this.packetQueue.forEach((item) => this.write(item));
      this.packetQueue = [];

      this.connectionProps.onReady();
    }, 0);
  }

  private onError(e: Event) {
    this.connectionProps.onError(new Error(e.toString()) as InworldError);
  }
}
