/**
 * Centralized log / warning / error message strings for the Mixpanel module.
 *
 * Why a map: log strings are testable surface (test assertions inspect
 * them verbatim) AND user-visible (devs grep the console). Keeping them
 * here makes it impossible to drift one of those audiences from the
 * other when a refactor changes wording.
 *
 * Add new messages here; never inline new `'[ppMixpanel] ...'` strings.
 *
 * Functions (M.xxx(args)) compose dynamic messages; plain constants
 * (M.xxx) cover static ones. The split keeps grep-able call sites
 * (`M.MODULE_LOADED` is just as searchable as the literal) without
 * losing type safety on interpolated values.
 */
const PREFIX = '[ppMixpanel]';

export const M = {
  // ---- Module lifecycle ----
  MODULE_LOADED: `${PREFIX} Module loaded`,
  MODULE_DISABLED: `${PREFIX} Module disabled via config`,
  NO_TOKEN: `${PREFIX} No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.`,
  TOKEN_EQUAL_REJECT: `${PREFIX} primary and secondary share the same token — refusing to init secondary. Same-token dual-write doubles ingest volume and corrupts identity-merge semantics. Verify ppLib.mixpanel.configure was called with distinct project tokens.`,
  INITIALIZED_SUCCESSFULLY: `${PREFIX} Initialized successfully`,
  INSTANCE_LOADED: (name: string): string => `${PREFIX} Instance loaded: ${name}`,
  INIT_FAILED: (name: string): string => `${PREFIX} init() failed for ${name}`,
  INIT_OPT_RESERVED: (key: string): string =>
    `${PREFIX} initOptions.${key} is reserved by the SDK orchestrator; ignoring caller override`,
  WATCHDOG_FORCE_DRAIN: (stuck: string, drained: number): string =>
    `${PREFIX} watchdog: ${stuck} did not report loaded within 15000ms; force-drained ${drained} buffered op(s) to ready instances. Check network / SRI / ad-blockers.`,
  WATCHDOG_NO_READY: (stuck: string): string =>
    `${PREFIX} watchdog: ${stuck} did not report loaded within 15000ms; no instance is ready, buffered events remain queued. Check network / SRI / ad-blockers.`,

  // ---- Loader / SDK ----
  SDK_LOAD_FAILED: (src: string): string =>
    `${PREFIX} Failed to load SDK from ${src} (SRI mismatch, network error, or blocker?)`,
  SRI_INVALID_FORMAT: `${PREFIX} integrity hash format invalid — expected sha256|sha384|sha512-<base64>; refusing to load`,
  SRI_REQUIRED_BUT_MISSING: `${PREFIX} requireIntegrity=true but no integrity hash configured — refusing to load`,
  SRI_MISSING_WARN: `${PREFIX} Loading SDK without SRI integrity — set shared.integrity (with a pinned cdnUrl) for hardening`,

  // ---- Track facade ----
  TRACK_EMPTY_EVENT_NAME: `${PREFIX} track called with empty eventName`,
  TRACK_FACADE_ERROR: `${PREFIX} track facade error`,
  PRE_INIT_QUEUE_FULL: `${PREFIX} pre-init queue full; dropping further events until init() completes`,
  PRE_INIT_DRAINED: (n: number): string => `${PREFIX} drained ${n} pre-init op(s)`,

  // ---- Dispatch ----
  UNKNOWN_DISPATCH_OP: `${PREFIX} unknown dispatch op`,
  DISPATCH_ERROR: `${PREFIX} dispatch error`,
  ALIAS_NO_TARGET: `${PREFIX} alias called but no targeted instance is enabled — Simplified ID Merge projects do not use alias; if primary is disabled (post-cutover), the call is a silent no-op. Pass { instances: ['secondary'] } if you really need it.`,

  // ---- Cookie migration ----
  PRE_INIT_COOKIE_READ_ERROR: `${PREFIX} Pre-init cookie read error`,
  ANON_SUBDOMAIN_MIGRATED: (oldId: string, newId: string): string =>
    `${PREFIX} Anonymous subdomain user migrated (old: ${oldId}, new: ${newId})`,
  IDENTIFIED_USER_MIGRATED: (id: string): string =>
    `${PREFIX} Identified user migrated (distinct_id: ${id})`,

  // ---- Identity sync ----
  SECONDARY_IDENTITY_SYNCED: `${PREFIX} secondary identity synced from primary`,
  IDENTITY_SYNC_NO_PRIMARY: `${PREFIX} syncIdentityFromPrimary: primary not loaded; secondary will start anonymous`,
  IDENTITY_SYNC_ERROR: `${PREFIX} syncIdentityFromPrimary error`,
  DISTINCT_ID_UNIFIED: (was: string | null, now: string): string =>
    `${PREFIX} Unified Mixpanel distinct_id with pp_distinct_id (was: ${was}, now: ${now})`,
  DISTINCT_ID_UNIFICATION_FAILED: `${PREFIX} distinct_id unification failed`,

  // ---- Shared context ----
  MARKETING_ATTR_REGISTERED: `${PREFIX} Registered marketingAttribution super-property`,
  MARKETING_ATTR_FAILED: `${PREFIX} Failed to register marketingAttribution super-property`,
  VWO_PROPS_REGISTERED: `${PREFIX} VWO experiment properties registered`,
  VWO_PROPS_FAILED: `${PREFIX} Failed to register VWO experiment properties`,

  // ---- Session ----
  SESSION_BOUNDARY_HANDLER_ERROR: `${PREFIX} session-boundary handler error`,

  // ---- Cookie hygiene (size hardening) ----
  MP_COOKIE_PRUNED: (name: string): string =>
    `${PREFIX} pruned non-primary Mixpanel cookie ${name} (only the primary project's cookie is retained to bound HTTP header size)`,
  MP_COOKIE_PRUNE_FAILED: `${PREFIX} non-primary Mixpanel cookie prune failed`,
  COOKIE_SIZE_WARN: (
    primaryBytes: number,
    totalBytes: number,
    primaryLimit: number,
    totalLimit: number,
  ): string =>
    `${PREFIX} cookie size over threshold — primary Mixpanel cookie ${primaryBytes}B (limit ${primaryLimit}B), total document.cookie ${totalBytes}B (limit ${totalLimit}B). Risk of HTTP 400/431 "request header/cookie too large"; trim persistent super-properties (register) — see shared-context.ts.`,
  COOKIE_SIZE_REPORT_FAILED: `${PREFIX} cookie size telemetry failed`,
} as const;

// ---- Magic-string constants outside the log domain ----
export const COOKIE_KEYS = {
  /** Per-token sessionStorage flag set after subdomain → parent migration
   *  ran for that token. Suffixed key avoids primary/secondary state sharing. */
  MIGRATION_FLAG: (token: string): string => `pp_mp_migrated_${token}`,
  /** Pre-dual-instance unsuffixed key. Read for defensive compat so users
   *  mid-rollout don't re-trigger migration. */
  LEGACY_MIGRATION_FLAG: 'pp_mp_migrated',
  /** Mixpanel SDK's cookie name format. The SDK writes one per token. */
  MP_COOKIE: (token: string): string => `mp_${token}_mixpanel`,
  /** Persisted VWO experiment props (read by the VWO bridge). */
  VWO_PROPS: 'pp_vwo_exp_props',
} as const;

export const DEFAULTS = {
  CDN_URL: 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js',
  SESSION_TIMEOUT_MS: 1800000,
  PRE_INIT_QUEUE_MAX: 200,
  VWO_BRIDGE_POLL_MAX_ATTEMPTS: 30,
  VWO_BRIDGE_POLL_INTERVAL_MS: 500,
  /**
   * Boot-time cookie-size warning thresholds (bytes). A single browser
   * cookie caps at ~4 KB and servers reject total request-header/cookie
   * payloads past ~8 KB (HTTP 400/431). We warn below those ceilings so the
   * operator gets a signal before users hit the hard error.
   *   - `COOKIE_WARN_PRIMARY_BYTES`: the `mp_<token>_mixpanel` cookie alone.
   *   - `COOKIE_WARN_TOTAL_BYTES`: the full `document.cookie` payload.
   */
  COOKIE_WARN_PRIMARY_BYTES: 3584,
  COOKIE_WARN_TOTAL_BYTES: 7168,
} as const;
