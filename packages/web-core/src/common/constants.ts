export const GRPC_HOSTNAME = 'studio.inworld.ai';
export const CLIENT_ID = 'web';
export const DEFAULT_USER_NAME = 'User';
export const SCENE_PATTERN =
  /^workspaces\/([a-z0-9-_]{1,61})\/(characters|scenes)\/([a-z0-9-_]{0,61})$/iu;

export const DEFAULT_SESSION_STATE_MAX_ATTEMPTS = 3;
export const DEFAULT_SESSION_STATE_KEY = 'inworldSessionState';
export const DEFAULT_SESSION_STATE_INTERVAL = 60 * 1000; // 1 minute
export const DEFAULT_SESSION_STATE_ATTEMPTS_INTERVAL = 5 * 100; // 0.5 seconds
