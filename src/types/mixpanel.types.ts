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
   * Override the Mixpanel SDK CDN URL. Defaults to
   * `https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js`. Use this to pin
   * to a specific version (e.g. `mixpanel-2-2.65.0.min.js`) so an
   * `integrity` hash can be set; the `-latest` URL drifts and would break
   * SRI on every Mixpanel release.
   */
  cdnUrl?: string;
  /**
   * Subresource Integrity hash for the Mixpanel CDN script
   * (e.g. 'sha384-…'). Only effective when paired with a pinned `cdnUrl`
   * — the default `-latest` URL changes whenever Mixpanel ships, which
   * would invalidate the hash and break the loader.
   */
  integrity?: string;
  /**
   * Defaults to 'anonymous' when `integrity` is set.
   */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /**
   * Fail-closed switch — refuse to inject the script if no `integrity`
   * is configured. Defaults to `false` (warn-only) so deployments don't
   * silently break analytics on a hash typo. See BrazeSdkConfig for the
   * full Phase-1 → Phase-3 rationale.
   */
  requireIntegrity?: boolean;
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
  getMixpanelCookieData: () => Record<string, unknown>;
  getConfig: () => MixpanelConfig;
}
