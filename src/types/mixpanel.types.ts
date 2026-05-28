import type { DeepPartial, SdkSecurityOptions } from '@src/types/utility.types';

export interface MixpanelCookieNames {
  userId: string;
  ipAddress: string;
  experiments: string;
}

// =====================================================
// Dual-instance core types
// =====================================================

export type InstanceName = 'primary' | 'secondary';

/**
 * Operations the dispatcher routes through. People-namespace ops carry the
 * `people.` prefix so a single flat union covers every Mixpanel surface we
 * call into. Keep in sync with the routing table in dispatch.ts.
 */
export type MixpanelOp =
  | 'track'
  | 'identify'
  | 'register'
  | 'register_once'
  | 'unregister'
  | 'alias'
  | 'reset'
  | 'opt_in_tracking'
  | 'opt_out_tracking'
  | 'people.set'
  | 'people.set_once'
  | 'people.increment'
  | 'people.append'
  | 'people.union'
  | 'people.unset'
  | 'people.track_charge';

export interface DispatchOptions {
  /** When omitted, dispatches to every currently-enabled instance. */
  instances?: InstanceName[];
  /**
   * When true, bypass the eventPropertiesBuilder enrichment merge on track().
   * Defaults to false — enrichment is the desired path for SDK-internal calls.
   */
  skipEnrichment?: boolean;
  /**
   * Watchdog-only escape hatch. When true, the dispatcher's "buffer if any
   * target is unready" rule is downgraded to "buffer only if NO target is
   * ready" — i.e. partial fan-out is allowed. Used by the boot watchdog
   * after a load timeout so events reach the instances that DID load
   * instead of staying buffered forever waiting for the stuck one.
   *
   * Never set this in user-facing API calls. Steady-state dispatch keeps
   * the all-ready rule so partial events don't silently break parity.
   */
  force?: boolean;
}

// =====================================================
// Configuration shapes
// =====================================================

/**
 * Per-instance config. Project-identity fields (`token`, `apiHost`,
 * `projectName`) and the runtime `enabled` flag live here. SDK-loader and
 * cross-cutting config (SRI, cookieNames, sessionTimeout, enrichTrack,
 * emitMode) live in SharedMixpanelConfig — they apply once to the single
 * injected <script> regardless of how many instances we run.
 */
export interface MixpanelInstanceConfig {
  enabled: boolean;
  token: string;
  /**
   * Mixpanel API endpoint for this instance's data-residency region.
   * Forwarded to `mixpanel.init({ api_host })`. Leave undefined to use
   * Mixpanel's US default. Set explicitly for EU / India projects.
   */
  apiHost?: string;
  /**
   * Optional human-readable label registered as the `project` super-prop.
   * Helpful when debugging events that flow to both instances and you want
   * the source project name on every event in Mixpanel's Debug View.
   */
  projectName?: string;
  /**
   * Passthrough into `mp.init(token, { ...initOptions }, name)`. Empty by
   * default — Simplified ID Merge is a server-side project setting in the
   * new project, so neither instance needs a client-side merge flag today.
   * Retained for future per-instance tuning (e.g. `persistence_name`,
   * `disable_persistence`, custom `loaded` hooks).
   */
  initOptions?: Record<string, unknown>;
}

/**
 * SDK-loader + cross-instance config. Applies to the single injected
 * <script> tag and to enrichment that happens once before fan-out.
 *
 * Per-instance overrides of these fields are NOT supported — the loader
 * stub injects exactly one script, so per-instance `cdnUrl` / `integrity`
 * cannot be enforced without breaking SRI guarantees.
 */
export interface SharedMixpanelConfig extends SdkSecurityOptions {
  crossSubdomainCookie: boolean;
  optOutByDefault: boolean;
  sessionTimeout: number;
  cookieNames: MixpanelCookieNames;
  nonce?: string;
  /**
   * Pinned CDN URL for SRI. Pin to a specific version
   * (e.g. `mixpanel-2-2.65.0.min.js`) before flipping `requireIntegrity`.
   */
  cdnUrl?: string;
  /**
   * When true, `ppLib.mixpanel.track()` merges the SDK's canonical event
   * properties into every track call before fan-out. Caller props win on
   * collision. Set false to forward caller props unchanged.
   */
  enrichTrack: boolean;
  /**
   * How the Mixpanel facade serializes the per-event property bag.
   *   - 'flat':   flat keys only (legacy).
   *   - 'dual':   both flat keys AND nested wrappers (migration default).
   *   - 'nested': nested wrappers only — the contract-aligned end state.
   *
   * Caller-passed properties win on collision in all modes.
   */
  emitMode: 'flat' | 'dual' | 'nested';
}

export interface DualMixpanelConfig {
  primary: MixpanelInstanceConfig;
  secondary: MixpanelInstanceConfig;
  shared: SharedMixpanelConfig;
}

/**
 * Legacy single-instance config kept for backward compatibility. When
 * `configure()` receives this flat shape it synthesizes a DualMixpanelConfig
 * with `secondary: { enabled: false }` so existing callers (`configure({
 * token: '...' })`) keep working unchanged.
 */
export interface MixpanelConfig extends SdkSecurityOptions {
  enabled: boolean;
  token: string;
  projectName: string;
  crossSubdomainCookie: boolean;
  optOutByDefault: boolean;
  sessionTimeout: number;
  cookieNames: MixpanelCookieNames;
  nonce?: string;
  cdnUrl?: string;
  apiHost?: string;
  enrichTrack: boolean;
  emitMode: 'flat' | 'dual' | 'nested';
}

export interface SessionManager {
  timeout: number;
  generateId: () => string;
  setId: () => void;
  check: () => void;
}

// =====================================================
// Public API surface
// =====================================================

/**
 * Single-instance facade exposed at `ppLib.mixpanel.primary` and
 * `ppLib.mixpanel.secondary`. Same surface as the top-level API but
 * targets one instance only — no `instances` option, no fan-out.
 */
export interface MixpanelInstanceFacade {
  track: (event: string, properties?: Record<string, unknown>) => boolean;
  identify: (id: string) => boolean;
  register: (props: Record<string, unknown>) => boolean;
  register_once: (props: Record<string, unknown>) => boolean;
  unregister: (prop: string) => boolean;
  alias: (id: string, original?: string) => boolean;
  reset: () => boolean;
  opt_in_tracking: () => boolean;
  opt_out_tracking: () => boolean;
  people: {
    set: (props: Record<string, unknown>) => boolean;
    set_once: (props: Record<string, unknown>) => boolean;
    increment: (props: Record<string, unknown> | string, by?: number) => boolean;
    append: (props: Record<string, unknown>) => boolean;
    union: (props: Record<string, unknown>) => boolean;
    unset: (props: string | string[]) => boolean;
    track_charge: (amount: number, props?: Record<string, unknown>) => boolean;
  };
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  getConfig: () => MixpanelInstanceConfig;
  /** Read this instance's Mixpanel cookie data (`mp_<token>_mixpanel`). */
  getCookieData: () => Record<string, unknown>;
}

export interface MixpanelAPI {
  /**
   * Accepts either the new DualMixpanelConfig shape or the legacy flat
   * MixpanelConfig shape. Legacy input is synthesized into a dual config
   * with `secondary: { enabled: false }` so existing single-instance
   * callers keep working unchanged.
   */
  configure: (
    options?: DeepPartial<DualMixpanelConfig> | DeepPartial<MixpanelConfig>,
  ) => DualMixpanelConfig;
  init: () => void;

  // -------- Functional core (dual-write by default) --------
  // Returns true when AT LEAST ONE targeted instance accepted the call
  // (either dispatched live or buffered into the pre-init queue).
  // Returns false only when every targeted instance failed or was disabled.

  /** SDK-internal track facade. Other modules (analytics, ecommerce,
   *  event-source) MUST use this instead of `window.mixpanel.track` so
   *  every event carries the SDK's canonical context block. */
  track: (
    eventName: string,
    properties?: Record<string, unknown>,
    options?: DispatchOptions,
  ) => boolean;
  identify: (id: string, options?: DispatchOptions) => boolean;
  register: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
  register_once: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
  unregister: (prop: string, options?: DispatchOptions) => boolean;
  /** Alias is excluded from secondary by default — Mixpanel's legacy
   *  Original-ID merge concept does not apply to Simplified ID Merge
   *  projects. Pass `{ instances: ['secondary'] }` to override if you
   *  really know what you're doing. */
  alias: (id: string, original?: string, options?: DispatchOptions) => boolean;
  reset: (options?: DispatchOptions) => boolean;
  opt_in_tracking: (options?: DispatchOptions) => boolean;
  opt_out_tracking: (options?: DispatchOptions) => boolean;
  people: {
    set: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
    set_once: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
    increment: (
      props: Record<string, unknown> | string,
      by?: number,
      options?: DispatchOptions,
    ) => boolean;
    append: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
    union: (props: Record<string, unknown>, options?: DispatchOptions) => boolean;
    unset: (props: string | string[], options?: DispatchOptions) => boolean;
    track_charge: (
      amount: number,
      props?: Record<string, unknown>,
      options?: DispatchOptions,
    ) => boolean;
  };

  // -------- Namespaced sugar (single-instance scope) --------
  primary: MixpanelInstanceFacade;
  secondary: MixpanelInstanceFacade;

  // -------- Lifecycle / utility --------
  setEnabled: (instance: InstanceName, enabled: boolean) => void;
  getConfig: () => DualMixpanelConfig;
  /** Read Mixpanel cookie data. Defaults to primary instance. */
  getMixpanelCookieData: (instance?: InstanceName) => Record<string, unknown>;
}
