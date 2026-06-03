export type LogLevel = 'error' | 'warn' | 'info' | 'verbose';

export interface SecurityConfig {
  maxParamLength: number;
  maxStorageSize: number;
  maxUrlLength: number;
  enableSanitization: boolean;
  strictMode: boolean;
}

export interface PPLibConfig {
  debug: boolean;
  verbose: boolean;
  namespace: string;
  security: SecurityConfig;
  // Opt-in raw error logging. Default false — `safeLogError` strips
  // `message` / `stack` because they routinely embed PII (emails in API
  // payloads, bearer tokens in fetch URLs). Local debug builds may enable
  // this to surface verbatim message + stack via `messageRaw` / `stack`.
  debugErrors?: boolean;
  /**
   * Domain attribute for cross-subdomain cookies (e.g. '.pocketpills.com').
   * Auto-detected at boot from window.location.hostname; left undefined in
   * dev / test (localhost, *.local, jsdom) so cookies stay host-scoped. May
   * be overridden by callers configuring the SDK pre-bootstrap.
   */
  cookieDomain?: string;
}

export interface SafeUtils {
  // Overloaded: literal-typed defaults (e.g. `''`, `0`) widen to their
  // primitive types so callers don't have to annotate. Object/array
  // defaults flow through generically. Without a default, the return is
  // `unknown` so the caller must narrow.
  get: {
    (obj: unknown, path: string, defaultValue: string): string;
    (obj: unknown, path: string, defaultValue: number): number;
    (obj: unknown, path: string, defaultValue: boolean): boolean;
    <T>(obj: unknown, path: string, defaultValue: T): T;
    (obj: unknown, path: string): unknown;
  };
  set: (obj: object, path: string, value: unknown) => boolean;
  toString: (val: unknown) => string;
  exists: (val: unknown) => boolean;
  toArray: <T = unknown>(val: T | T[] | null | undefined) => T[];
  forEach: <T>(arr: T[], callback: (item: T, index: number, arr: T[]) => void) => void;
}

export interface SecurityJson {
  parse: {
    (str: string, fallback: string): string;
    (str: string, fallback: number): number;
    (str: string, fallback: boolean): boolean;
    <T>(str: string, fallback: T): T;
    (str: string): unknown;
  };
  stringify: (obj: unknown) => string | null;
}

export interface Security {
  sanitize: (input: unknown) => string;
  isValidUrl: (url: string) => boolean;
  // Allowlist-gated redirect validator. Same-origin URLs and relative paths
  // pass automatically; cross-origin URLs must match an entry in
  // `allowedHosts` (exact host or `.host` suffix). Used by anchor-driven
  // navigation interception to prevent attacker-injected hrefs from
  // redirecting users off-site after the analytics flush delay.
  isSafeRedirectUrl: (url: string, allowedHosts?: string[]) => boolean;
  json: SecurityJson;
  validateData: (data: unknown) => boolean;
}

export interface Storage {
  isAvailable: (type?: string) => boolean;
  getKey: (key: string) => string;
  set: (key: string, value: unknown, persistent?: boolean) => boolean;
  get: <T = unknown>(key: string, persistent?: boolean, validate?: (v: unknown) => v is T) => T | null;
  remove: (key: string, persistent?: boolean) => void;
  clear: () => void;
}

export interface PPLib {
  version: string;
  _isReady: boolean;
  /**
   * Resolves after the Mixpanel module's `mp.init` loaded callback fires.
   * At that point `window.mixpanel.get_property('$device_id')` is readable,
   * so the event-properties builder can attach a consistent `device_id`
   * to events on every destination (Mixpanel, dataLayer, Braze).
   *
   * Modules that need consistent identifiers across destinations
   * (analytics auto-pageview, ecommerce auto-events) should await this
   * before dispatching their initial events.
   *
   * On environments without the mixpanel module loaded, or when the
   * Mixpanel CDN is blocked, this resolves via a 3-second timeout
   * fallback so non-Mixpanel destinations still function (with empty
   * `device_id` — industry-standard behavior for blocked SDKs).
   */
  mixpanelReady: Promise<void>;
  /** Internal — invoked by mixpanel module's onAllLoaded callback. */
  _resolveMixpanelReady?: () => void;
  config: PPLibConfig;
  SafeUtils: SafeUtils;
  Security: Security;
  Storage: Storage;
  getCookie: (name: string) => string | null;
  deleteCookie: (name: string) => void;
  /**
   * Write a cookie with optional domain / max-age / SameSite / Secure controls.
   * URL-encodes the value. Skips the Domain attribute when the current
   * hostname doesn't end with the configured root (dev/test safety).
   * See `src/common/cookies.ts` for full semantics.
   */
  setCookie: (name: string, value: string, options?: import('../common/cookies').SetCookieOptions) => void;
  getQueryParam: (url: string, findParam: string) => string;
  log: (level: LogLevel, message: string, data?: unknown) => void;
  // PII-safe payload helper. Wraps untrusted user-attribute / event-property
  // bags before they reach console / DevTools / Sentry. See
  // src/common/log-sanitize.ts for the redaction rules.
  // Required (not optional) — installed unconditionally by the common module
  // at boot, mirroring `safeLogError` below. Defensive null-checks at call
  // sites are unnecessary noise.
  safeLogPayload: (value: unknown) => unknown;
  // PII-safe error helper. Wraps caught exceptions before they reach the log
  // pipeline. Drops `message` (PII risk) and `stack` (URL-leak risk),
  // surfacing `errorClass`, `messageShape`, and the typed-error context
  // fields (`endpoint`, `status`, `attempt`, `cause`) instead. Honours
  // `config.debugErrors` (read dynamically at call time, so toggling it at
  // runtime takes effect for the very next error). Returns a discriminated
  // union; callers branching on `errorClass` get safe field narrowing.
  safeLogError: (err: unknown) => import('../common/log-sanitize').SafeLogErrorResult;
  extend: <T extends object, U>(target: T, source: U) => T & U;
  ready: (callback: (ppLib: PPLib) => void) => void;
  // Unified consent gate. Dispatch sites (mixpanel.track facade, ecommerce
  // pushes, event-source dispatches) call `consent.isGranted()` before
  // sending. Default mode is opt-out — flip to 'opt-in' for GDPR regions.
  consent: import('../common/consent').ConsentService;
  analytics?: import('./analytics.types').AnalyticsAPI;
  login?: import('./login.types').LoginAPI;
  ecommerce?: import('./ecommerce.types').EcommerceAPI;
  eventSource?: import('./event-source.types').EventSourceAPI;
  mixpanel?: import('./mixpanel.types').MixpanelAPI;
  braze?: import('./braze.types').BrazeAPI;
  voucherify?: import('./voucherify.types').VoucherifyAPI;
  datalayer?: import('./datalayer.types').DataLayerAPI;
  vwo?: import('./vwo.types').VWOAPI;
  // Session management
  session?: import('../common/session').SessionService;
  // DataLayer enricher system. The push args are intentionally unknown[] —
  // callers from third-party tools (GTM, custom dataLayer pushes) feed
  // arbitrary shapes; enrichers must validate before treating them as events.
  registerEnricher?: (enricherFn: (pushFn: (...args: unknown[]) => number) => (...args: unknown[]) => number) => void;
  _enrichers?: Array<(pushFn: (...args: unknown[]) => number) => (...args: unknown[]) => number>;
  // Shared event-properties builder (consumed by datalayer enricher and mixpanel.track wrapper)
  eventPropertiesBuilder?: import('../common/event-properties-builder').EventPropertiesBuilder;
  // Internal bound flags (prevent double-binding across script reloads)
  _ecomBound?: boolean;
  _esBound?: boolean;
  _mpTrackPatched?: boolean;
  _firedEvents?: Record<string, boolean>;
  _vwoExperimentProps?: Record<string, string>;
}
