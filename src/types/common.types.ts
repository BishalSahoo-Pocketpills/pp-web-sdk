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
  json: SecurityJson;
  validateData: (data: unknown) => boolean;
}

export interface Storage {
  isAvailable: (type?: string) => boolean;
  getKey: (key: string) => string;
  set: (key: string, value: unknown, persistent?: boolean) => boolean;
  get: <T = unknown>(key: string, persistent?: boolean) => T | null;
  remove: (key: string, persistent?: boolean) => void;
  clear: () => void;
}

export interface PPLib {
  version: string;
  _isReady: boolean;
  config: PPLibConfig;
  SafeUtils: SafeUtils;
  Security: Security;
  Storage: Storage;
  getCookie: (name: string) => string | null;
  deleteCookie: (name: string) => void;
  getQueryParam: (url: string, findParam: string) => string;
  log: (level: string, message: string, data?: unknown) => void;
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
  attribution: import('../common/attribution').AttributionService;
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
