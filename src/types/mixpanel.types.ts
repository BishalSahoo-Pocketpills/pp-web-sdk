export interface MixpanelCookieNames {
  userId: string;
  ipAddress: string;
  experiments: string;
}

export interface MixpanelConfig {
  enabled: boolean;
  token: string;
  projectName: string;
  crossSubdomainCookie: boolean;
  optOutByDefault: boolean;
  sessionTimeout: number;
  cookieNames: MixpanelCookieNames;
  nonce?: string;
  /**
   * When true (default), `ppLib.mixpanel.track()` merges the SDK's canonical
   * event properties (UTM touch attribution, device/session/login state,
   * marketing attribution, click IDs) into every track call. Caller-passed
   * properties always win on key collision.
   *
   * Set to false to forward the caller's properties unchanged. Mixpanel's
   * existing super-properties continue to attach automatically either way.
   */
  enrichTrack: boolean;
}

export interface SessionManager {
  timeout: number;
  generateId: () => string;
  setId: () => void;
  check: () => void;
}

export interface MixpanelAPI {
  configure: (options?: Partial<MixpanelConfig>) => MixpanelConfig;
  init: () => void;
  /**
   * Internal SDK facade for sending events to Mixpanel. Other SDK modules
   * (analytics, ecommerce, event-source) MUST use this instead of calling
   * `window.mixpanel.track` directly so every event carries the SDK's
   * canonical context block.
   *
   * No-op (returns false) if Mixpanel isn't loaded yet or is disabled.
   * Returns true when forwarded.
   */
  track: (eventName: string, properties?: Record<string, unknown>) => boolean;
  getMixpanelCookieData: () => Record<string, any>;
  getConfig: () => MixpanelConfig;
}
