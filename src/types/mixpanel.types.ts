import type { DeepPartial, SdkSecurityOptions } from '@src/types/utility.types';

export interface MixpanelCookieNames {
  userId: string;
  ipAddress: string;
  experiments: string;
}

export interface MixpanelConfig extends SdkSecurityOptions {
  enabled: boolean;
  token: string;
  projectName: string;
  crossSubdomainCookie: boolean;
  optOutByDefault: boolean;
  sessionTimeout: number;
  cookieNames: MixpanelCookieNames;
  nonce?: string;
  // SRI is only effective when paired with a pinned cdnUrl — the default
  // `-latest` URL changes whenever Mixpanel ships, which would
  // invalidate the hash and break the loader. Pin to a specific version
  // (e.g. `mixpanel-2-2.65.0.min.js`) before flipping requireIntegrity.
  cdnUrl?: string;
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
  /**
   * How the Mixpanel facade serializes the per-event property bag.
   *   - 'flat':   current legacy behavior — flat keys only (no nested wrappers).
   *   - 'dual':   both flat keys AND nested wrappers (default for migration).
   *   - 'nested': nested wrappers only — eventProperties / userProperties /
   *               page / attribution. The contract-aligned end state.
   *
   * 'dual' is the default so consumers' Mixpanel reports / BigQuery queries
   * can migrate to the nested shape on their own schedule. Flip to 'nested'
   * once downstream is ready.
   */
  emitMode: 'flat' | 'dual' | 'nested';
}

export interface SessionManager {
  timeout: number;
  generateId: () => string;
  setId: () => void;
  check: () => void;
}

export interface MixpanelAPI {
  configure: (options?: DeepPartial<MixpanelConfig>) => MixpanelConfig;
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
  getMixpanelCookieData: () => Record<string, unknown>;
  getConfig: () => MixpanelConfig;
}
