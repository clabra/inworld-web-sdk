import { SessionState } from '../../proto/ai/inworld/engine/v1/state_serialization.pb';
import {
  DEFAULT_SESSION_STATE_ATTEMPTS_INTERVAL,
  DEFAULT_SESSION_STATE_INTERVAL,
  DEFAULT_SESSION_STATE_KEY,
  DEFAULT_SESSION_STATE_MAX_ATTEMPTS,
} from '../common/constants';
import { safeJSONParse } from '../common/helpers';
import { CHAT_HISTORY_TYPE } from '../components/history';
import { ConnectionService } from './connection.service';

export class SessionStateService {
  private connection: ConnectionService;

  private intervalId: NodeJS.Timeout | undefined;
  private maxAttempts = DEFAULT_SESSION_STATE_MAX_ATTEMPTS;

  private isBlurred = false;
  private isSaving = false;

  constructor(connection: ConnectionService) {
    this.connection = connection;

    window.addEventListener('blur', this.onWindowBlur.bind(this));
    window.addEventListener('focus', this.onWindowFocus.bind(this));

    setInterval(() => {
      if (!this.isBlurred) {
        this.tryToSaveState();
      }
    }, DEFAULT_SESSION_STATE_INTERVAL);
  }

  destroy() {
    this.clearInterval();

    window.removeEventListener('blur', this.onWindowBlur.bind(this));
    window.removeEventListener('focus', this.onWindowFocus.bind(this));
  }

  private onWindowBlur() {
    this.isBlurred = true;

    this.tryToSaveState();
  }

  private onWindowFocus() {
    this.isBlurred = false;

    setInterval(() => {
      this.tryToSaveState();
    }, DEFAULT_SESSION_STATE_INTERVAL);
  }

  private tryToSaveState() {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;

    const history = this.connection.getHistory();
    const lastItem = history[history.length - 1];
    const saved = localStorage.getItem(DEFAULT_SESSION_STATE_KEY);
    const sessionState = saved ? safeJSONParse<SessionState>(saved) : undefined;

    // Don't save session state if it's already saved.
    if (
      !lastItem ||
      (sessionState?.creationTime &&
        lastItem?.date &&
        new Date(sessionState.creationTime).getTime() > lastItem.date.getTime())
    ) {
      this.isSaving = false;
      return;
    }

    let attempts = 0;

    setInterval(() => {
      attempts++;

      // Try to wait for interaction end event before saving session state.
      // If all attempts are failed, just save session state here.
      if (attempts >= this.maxAttempts) {
        this.saveSessionState();
        return;
      }

      // Don't save session state if there are packets in progress.
      if (this.connection.hasPacketsInProgress()) {
        return;
      }

      // Save session state if last item in history is interaction end event.
      const history = this.connection.getHistory();
      const lastItem = history[history.length - 1];

      if (lastItem?.type === CHAT_HISTORY_TYPE.INTERACTION_END) {
        this.saveSessionState();
      }
    }, DEFAULT_SESSION_STATE_ATTEMPTS_INTERVAL);
  }

  async loadSessionState() {
    return localStorage.getItem(DEFAULT_SESSION_STATE_KEY);
  }

  private async saveSessionState() {
    this.clearInterval();

    this.connection
      .getSessionState()
      .then((sessionState) =>
        localStorage.setItem(
          DEFAULT_SESSION_STATE_KEY,
          JSON.stringify(sessionState),
        ),
      )
      .catch(this.connection.onError)
      .finally(() => {
        this.isSaving = false;
      });
  }

  private clearInterval() {
    clearInterval(this.intervalId);

    this.intervalId = undefined;
  }
}
