/**
 * pp-analytics-lib: Mixpanel Module — DUAL INSTANCE
 *
 * Public surface:
 *   - Functional core: ppLib.mixpanel.{track, identify, register, ...} —
 *     fans out to every enabled instance by default. Pass
 *     `{ instances: ['primary'] }` (or `['secondary']`) as the trailing
 *     options arg to override.
 *   - Namespaced sugar: ppLib.mixpanel.primary.* / ppLib.mixpanel.secondary.*
 *     target one instance only.
 *   - Lifecycle: configure(), init(), setEnabled(name, bool), getConfig().
 *
 * Architecture: orchestrator + dispatcher. This file owns the boot
 * sequence (load SDK once → init primary → primary's loaded callback chains
 * secondary → secondary's loaded callback runs identity-sync, then shared
 * context fans to both, then the pre-init queue drains). All ops route
 * through dispatch.ts which handles consent gating, enrichment,
 * per-instance error isolation, and routing rules.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.mixpanel
 */
import type { PPLib } from '@src/types/common.types';
import { cloneConfig } from '@src/common/clone-config';
import type {
  DualMixpanelConfig,
  InstanceName,
  MixpanelAPI,
  MixpanelConfig,
  MixpanelInstanceConfig,
  SharedMixpanelConfig,
} from '@src/types/mixpanel.types';
import type { DeepPartial } from '@src/types/utility.types';
import type { MixpanelGlobal } from '@src/types/window';
import { bootstrapModule } from '@src/common/bootstrap';
import {
  applyDualConfig,
  getEnabledStates,
  getState,
  makeInstanceFacade,
  resetInstanceState,
  setEnabled as setStateEnabled,
} from '@src/mixpanel/instance-state';
import {
  configureDispatcher,
  dispatch,
  drainIfReady,
  drainToReady,
} from '@src/mixpanel/dispatch';
import { size as queueSize } from '@src/mixpanel/pre-init-queue';
import { configureLoader, loadMixpanelSDK } from '@src/mixpanel/loader';
import {
  SessionManager,
  configureSession,
  patchInstanceTrack,
  resetSession,
} from '@src/mixpanel/session';
import { configureCampaign, resetSessionCampaign } from '@src/mixpanel/campaign';
import {
  configureSharedContext,
  registerProjectName,
  registerSharedContext,
} from '@src/mixpanel/shared-context';
import {
  applyMigrationIfNeeded,
  configureCookieMigration,
  readPreInitDistinctId,
} from '@src/mixpanel/cookie-migration';
import {
  configureIdentitySync,
  syncIdentityFromPrimary,
} from '@src/mixpanel/identity-sync';
import { resetQueue } from '@src/mixpanel/pre-init-queue';
import { DEFAULTS, M } from '@src/mixpanel/messages';

(function (win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib): void {
    // =====================================================
    // DEFAULT CONFIGURATION
    // =====================================================

    const CONFIG: DualMixpanelConfig = {
      primary: {
        enabled: true,
        token: '',
        projectName: '',
        initOptions: {},
      },
      secondary: {
        enabled: false,
        token: '',
        projectName: '',
        initOptions: {},
      },
      shared: {
        crossSubdomainCookie: true,
        optOutByDefault: false,
        sessionTimeout: DEFAULTS.SESSION_TIMEOUT_MS,
        cookieNames: {
          userId: 'userId',
          ipAddress: 'ipAddress',
          experiments: 'exp',
        },
        enrichTrack: true,
        // 'flat' default — Mixpanel receives a flat key shape per the
        // Analytics events spec. dataLayer / GTM still gets the nested
        // GA4 shape via its own enricher.
        emitMode: 'flat',
      },
    };

    // =====================================================
    // CONFIG SHIM — legacy MixpanelConfig (flat) → DualMixpanelConfig
    // =====================================================

    function looksLikeDualShape(opts: object): boolean {
      return 'primary' in opts || 'secondary' in opts || 'shared' in opts;
    }

    /**
     * Detect legacy flat shape (`{ token, apiHost, ... }`) and synthesize
     * a dual-instance config slice. Callers passing legacy options get
     * primary populated from those options; secondary stays disabled with
     * empty token so the new code paths are inert until explicitly enabled.
     */
    function legacyToDualSlice(
      legacy: DeepPartial<MixpanelConfig>,
    ): DeepPartial<DualMixpanelConfig> {
      const slice: DeepPartial<DualMixpanelConfig> = {};
      const primary: DeepPartial<MixpanelInstanceConfig> = {};
      const shared: DeepPartial<SharedMixpanelConfig> = {};

      // Instance-scope fields.
      if ('enabled' in legacy) primary.enabled = legacy.enabled as boolean;
      if ('token' in legacy) primary.token = legacy.token as string;
      if ('apiHost' in legacy) primary.apiHost = legacy.apiHost as string;
      if ('projectName' in legacy) primary.projectName = legacy.projectName as string;

      // Shared-scope fields.
      if ('crossSubdomainCookie' in legacy)
        shared.crossSubdomainCookie = legacy.crossSubdomainCookie as boolean;
      if ('optOutByDefault' in legacy)
        shared.optOutByDefault = legacy.optOutByDefault as boolean;
      if ('sessionTimeout' in legacy) shared.sessionTimeout = legacy.sessionTimeout as number;
      if ('cookieNames' in legacy)
        shared.cookieNames = legacy.cookieNames as SharedMixpanelConfig['cookieNames'];
      if ('enrichTrack' in legacy) shared.enrichTrack = legacy.enrichTrack as boolean;
      if ('emitMode' in legacy)
        shared.emitMode = legacy.emitMode as SharedMixpanelConfig['emitMode'];
      if ('nonce' in legacy) shared.nonce = legacy.nonce as string;
      if ('cdnUrl' in legacy) shared.cdnUrl = legacy.cdnUrl as string;
      if ('integrity' in legacy) shared.integrity = legacy.integrity as string;
      if ('requireIntegrity' in legacy)
        shared.requireIntegrity = legacy.requireIntegrity as boolean;
      if ('crossOrigin' in legacy)
        shared.crossOrigin = legacy.crossOrigin as SharedMixpanelConfig['crossOrigin'];

      if (Object.keys(primary).length > 0) slice.primary = primary;
      if (Object.keys(shared).length > 0) slice.shared = shared;
      return slice;
    }

    /** 2-level deep merge tailored to DualMixpanelConfig's shape. ppLib.extend
     *  is shallow, which would clobber nested config objects (e.g.
     *  shared.cookieNames). Local merge keeps the existing extend semantics
     *  intact elsewhere while giving callers safe nested overrides here. */
    function applyConfig(
      target: DualMixpanelConfig,
      source: DeepPartial<DualMixpanelConfig>,
    ): void {
      if (source.primary) Object.assign(target.primary, source.primary);
      if (source.secondary) Object.assign(target.secondary, source.secondary);
      if (source.shared) {
        const { cookieNames, ...rest } = source.shared as SharedMixpanelConfig & {
          cookieNames?: SharedMixpanelConfig['cookieNames'];
        };
        Object.assign(target.shared, rest);
        if (cookieNames) Object.assign(target.shared.cookieNames, cookieNames);
      }
    }

    /**
     * Back-compat projection — flatten the dual config so existing callers
     * (tests, debug consoles) that read `result.token`, `result.cookieNames`,
     * `result.emitMode`, etc. keep working without changes. New code can
     * still drill into `.primary.*` / `.shared.*` explicitly.
     *
     * The projection is a deep clone, so mutating fields on the returned
     * object cannot leak back into the internal CONFIG.
     */
    function legacyProjectionFromDual(cfg: DualMixpanelConfig): DualMixpanelConfig {
      const cloned = cloneConfig(cfg);
      const projection = cloned as DualMixpanelConfig & Record<string, unknown>;
      // Top-level primary fields (token, apiHost, projectName, initOptions, enabled).
      const primKeys = Object.keys(cloned.primary) as Array<keyof MixpanelInstanceConfig>;
      for (let i = 0; i < primKeys.length; i++) {
        const k = primKeys[i];
        projection[k as string] = cloned.primary[k];
      }
      // Top-level shared fields (cookieNames, sessionTimeout, etc).
      const sharedKeys = Object.keys(cloned.shared) as Array<keyof SharedMixpanelConfig>;
      for (let i = 0; i < sharedKeys.length; i++) {
        const k = sharedKeys[i];
        projection[k as string] = cloned.shared[k];
      }
      return projection;
    }

    // =====================================================
    // BOOT ORCHESTRATION
    // =====================================================

    /**
     * Final-loaded handler. Runs after every enabled instance has reported
     * `loaded`. Mints the first shared session ID, fans out shared context
     * (UTM, marketing attribution, VWO bridge), and drains the pre-init
     * queue. Idempotent — calling twice is safe but redundant.
     */
    let allLoadedFired = false;
    function onAllLoaded(): void {
      if (allLoadedFired) return;
      allLoadedFired = true;
      // Update session timeout from config (may have been overridden post-init).
      SessionManager.timeout = CONFIG.shared.sessionTimeout;
      // Mint initial session — fans to all enabled-and-ready instances.
      SessionManager.check();
      // Sync Mixpanel's $device_id into pp_device_id cookie BEFORE we
      // release the readiness gate. Mixpanel is the source of truth for
      // the anonymous device identifier; the cookie is a cross-subdomain
      // mirror so Angular and the dataLayer enricher see the same value.
      syncDeviceIdFromMixpanel();
      // Shared super-props (base, cookies, experiments, UTM, marketing, VWO).
      registerSharedContext(win, doc);
      // Replay any pre-init buffered ops through the full enrichment path.
      drainIfReady();
      // Release the readiness gate — modules waiting on
      // ppLib.mixpanelReady (analytics auto-pageview, ecommerce auto-
      // events) now fire with consistent identifiers across destinations.
      if (typeof ppLib._resolveMixpanelReady === 'function') {
        ppLib._resolveMixpanelReady();
      }
      ppLib.log('info', M.INITIALIZED_SUCCESSFULLY);
    }

    /**
     * Read $device_id from primary (preferred) or secondary (fallback)
     * and write it to the pp_device_id cookie. Primary is the source of
     * truth — syncIdentityFromPrimary has already pinned secondary to
     * primary's value, so they should match; we still try primary first
     * because that's the contract.
     *
     * The cookie is a 2-year cross-subdomain mirror so Angular and the
     * dataLayer enricher can read the same value without depending on
     * the Mixpanel cookie's token-suffixed name.
     */
    function syncDeviceIdFromMixpanel(): void {
      try {
        const primary = getState('primary');
        const secondary = getState('secondary');
        const source =
          primary.enabled && primary.mpRef
            ? primary.mpRef
            : secondary.enabled && secondary.mpRef
              ? secondary.mpRef
              : null;
        if (source === null || typeof source.get_property !== 'function') return;
        const deviceId = source.get_property('$device_id');
        if (typeof deviceId !== 'string' || deviceId.length === 0) return;
        ppLib.setCookie('pp_device_id', deviceId, {
          domain: ppLib.config.cookieDomain,
          path: '/',
          maxAgeSeconds: 63072000,
          sameSite: 'Lax',
        });
      } catch (e) {
        ppLib.log('warn', 'syncDeviceIdFromMixpanel failed', ppLib.safeLogError(e));
      }
    }

    // Keys the orchestrator owns. A caller-supplied `initOptions.loaded`
    // would silently overwrite onInstanceLoaded → identity sync never runs,
    // pre-init queue never drains, watchdog fires at 15s. The other
    // reserved keys are load-time semantics the dispatcher relies on
    // (consent gating, dual-pageview suppression, beacon transport).
    const RESERVED_INIT_OPTS = [
      'loaded',
      'cross_subdomain_cookie',
      'opt_out_tracking_by_default',
      'track_pageview',
      'api_transport',
      'api_host',
    ];

    function buildInitOptions(
      instanceCfg: MixpanelInstanceConfig,
      loaded: (mp: MixpanelGlobal) => void,
    ): Record<string, unknown> {
      const opts: Record<string, unknown> = {
        cross_subdomain_cookie: CONFIG.shared.crossSubdomainCookie,
        opt_out_tracking_by_default: CONFIG.shared.optOutByDefault,
        api_transport: 'sendBeacon',
        // Mixpanel's built-in autotrack pageview is suppressed — the
        // analytics module fires its own enriched pageview event. Two
        // pageviews per visit otherwise.
        track_pageview: false,
        loaded,
      };
      // Per-instance passthrough — empty by default since Simplified ID
      // Merge is a server-side project setting (no client flag needed).
      // Reserved keys (especially `loaded`) are skipped with a loud warn:
      // overriding them breaks the boot orchestration and the failure
      // mode (events buffered indefinitely until the watchdog) is silent.
      if (instanceCfg.initOptions) {
        const keys = Object.keys(instanceCfg.initOptions);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (RESERVED_INIT_OPTS.indexOf(k) >= 0) {
            ppLib.log('warn', M.INIT_OPT_RESERVED(k));
            continue;
          }
          opts[k] = instanceCfg.initOptions[k];
        }
      }
      if (instanceCfg.apiHost) opts.api_host = instanceCfg.apiHost;
      return opts;
    }

    function initInstance(name: InstanceName): void {
      const state = getState(name);
      if (!state.enabled || !state.config.token) return;
      if (state.initCalled) return;
      state.initCalled = true;

      const opts = buildInitOptions(state.config, function loadedCb(mp: MixpanelGlobal) {
        onInstanceLoaded(name, mp);
      });

      // For primary, mp.init(token, opts) writes to window.mixpanel itself.
      // For secondary, mp.init(token, opts, 'secondary') queues onto the
      // shared stub's `_i[]` and the real SDK creates window.mixpanel.secondary
      // on replay.
      try {
        if (name === 'primary') {
          (win.mixpanel as MixpanelGlobal).init(state.config.token, opts);
        } else {
          (win.mixpanel as MixpanelGlobal).init(state.config.token, opts, name);
        }
      } catch (e) {
        ppLib.log('error', M.INIT_FAILED(name), ppLib.safeLogError(e));
      }
    }

    /**
     * Per-instance loaded callback. Runs once per instance after the real
     * Mixpanel SDK has replayed its `_i[]` entry and created the live
     * Mixpanel handle (window.mixpanel for primary, window.mixpanel.secondary
     * for secondary).
     */
    function onInstanceLoaded(name: InstanceName, mp: MixpanelGlobal): void {
      const state = getState(name);
      state.mpRef = mp;

      // Opt-in tracking unless explicitly opted-out at boot.
      if (!CONFIG.shared.optOutByDefault) {
        try {
          mp.opt_in_tracking();
        } catch (_e) {
          /* legacy mock may not implement — non-fatal */
        }
      }

      // PRIMARY-ONLY: subdomain cookie migration + pp_distinct_id unification.
      // Both are migration-era concerns that the secondary (fresh project)
      // has no state to migrate from.
      if (name === 'primary') {
        applyMigrationIfNeeded(mp, primaryMigrationCtx);
      } else {
        // SECONDARY: pin $device_id from primary BEFORE any tracks fire.
        // syncIdentityFromPrimary internally guards if primary isn't ready.
        syncIdentityFromPrimary(mp);
      }

      // Patch this instance's `mp.track` so SessionManager.check() runs
      // before every event. The session-boundary handler resets last-touch
      // attribution on session timeout.
      patchInstanceTrack(state, resetSessionCampaign);
      ppLib._mpTrackPatched = true;

      // Per-instance project label (super-prop).
      if (state.config.projectName) {
        registerProjectName([name], state.config.projectName);
      }

      state.initialized = true;
      ppLib.log('info', M.INSTANCE_LOADED(name));

      // Both inits were queued against the stub upfront (initAll), so the
      // real Mixpanel SDK replays them in order — this loaded callback
      // fires for each instance independently. When the last enabled
      // instance reports ready, fire the shared all-loaded handler.
      if (allEnabledLoaded()) {
        clearWatchdog();
        onAllLoaded();
      }
    }

    function allEnabledLoaded(): boolean {
      const enabled = getEnabledStates();
      if (enabled.length === 0) return false;
      for (let i = 0; i < enabled.length; i++) {
        if (!enabled[i].initialized || !enabled[i].mpRef) return false;
      }
      return true;
    }

    // Primary migration context — captured pre-init, applied in primary's
    // loaded callback. Secondary doesn't migrate (fresh project).
    let primaryMigrationCtx: ReturnType<typeof readPreInitDistinctId> = {
      preInitDistinctId: null,
    };

    function initAll(): void {
      const primaryState = getState('primary');
      /*! v8 ignore start */
      if (!primaryState.enabled) {
      /*! v8 ignore stop */
        ppLib.log('info', M.MODULE_DISABLED);
        return;
      }
      /*! v8 ignore start */
      if (!primaryState.config.token) {
      /*! v8 ignore stop */
        ppLib.log('warn', M.NO_TOKEN);
        return;
      }

      // Token-equality guard — primary and secondary MUST be different
      // Mixpanel projects. Same-token misconfig silently double-bills,
      // doubles ingest volume, and corrupts the identity-merge story
      // (two writes with the same $device_id to the same project produce
      // a single profile and double event counts). Disable secondary in
      // this case so the operator sees the loud error and the SDK keeps
      // primary-only behavior.
      const secondaryState = getState('secondary');
      if (
        secondaryState.enabled &&
        secondaryState.config.token &&
        secondaryState.config.token === primaryState.config.token
      ) {
        ppLib.log('error', M.TOKEN_EQUAL_REJECT);
        secondaryState.enabled = false;
        CONFIG.secondary.enabled = false;
      }

      // Refresh module-scoped state from the resolved CONFIG. The wiring
      // helpers were also called at IIFE boot with the default config so
      // dispatch/buffering work pre-init; re-applying here picks up any
      // post-configure() overrides (sessionTimeout, cookieNames, etc).
      applyDualConfig(CONFIG);
      configureLoader(ppLib, CONFIG.shared);
      configureDispatcher(ppLib, CONFIG.shared);
      configureSession(ppLib, CONFIG.shared.sessionTimeout);
      configureSharedContext(ppLib, CONFIG.shared.cookieNames);

      // Single SDK script injection. SRI fail-closed returns false; bail
      // out before stub access so we don't dereference an undefined global.
      const loaded = loadMixpanelSDK(win, doc);
      if (!loaded || !win.mixpanel) return;

      // Pre-init: read legacy distinct_id BEFORE Mixpanel overwrites the
      // cookie. Primary only — secondary is a fresh project.
      primaryMigrationCtx = readPreInitDistinctId(
        win,
        primaryState.config.token,
        CONFIG.shared.crossSubdomainCookie,
      );

      // Queue BOTH instance inits against the stub upfront — canonical
      // Mixpanel multi-instance pattern. The real SDK replays `_i[]` in
      // order, firing each `loaded` callback independently. Doing this
      // upfront (vs chaining secondary from primary's loaded callback)
      // avoids depending on the real SDK's late-init-of-named-instance
      // semantics, which caused secondary.loaded to never fire — leaving
      // the pre-init queue buffered indefinitely.
      initInstance('primary');
      if (getState('secondary').enabled) initInstance('secondary');

      // Watchdog — if the SDK doesn't load (network failure, ad-blocker,
      // SRI mismatch) the loaded callbacks never fire and the pre-init
      // queue never drains. After WATCHDOG_MS we force-drain to whatever
      // instances are ready so events aren't silently swallowed.
      armWatchdog();
    }

    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const WATCHDOG_MS = 15000;

    function armWatchdog(): void {
      if (watchdogTimer) return;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (allLoadedFired) return;

        const enabled = getEnabledStates();
        const stuck = enabled.filter((s) => !s.initialized);
        const stuckNames = stuck.map((s) => s.name).join('+');

        // Bypass `drainIfReady`'s "all enabled ready" gate. drainToReady
        // replays through `dispatch`, which routes only to instances that
        // resolve via `resolveMpRef`. Entries that can't reach any ready
        // instance are re-enqueued by dispatch's own buffer path — they
        // remain queued for whenever the stuck instance recovers.
        const dispatched = drainToReady();
        const remaining = queueSize();

        if (stuck.length > 0) {
          if (dispatched > 0) {
            ppLib.log('warn', M.WATCHDOG_FORCE_DRAIN(stuckNames, dispatched));
          } else if (remaining > 0) {
            // Nothing was ready; entries got re-buffered. Be explicit so
            // the operator doesn't read "watchdog fired" and assume drain
            // happened.
            ppLib.log('warn', M.WATCHDOG_NO_READY(stuckNames));
          } else {
            // No buffered entries at all — stuck but idle. Still surface
            // the load failure so observability picks it up.
            ppLib.log('warn', M.WATCHDOG_FORCE_DRAIN(stuckNames, 0));
          }
        }

        // Mark all-loaded fired so a late `loaded` callback (after the
        // watchdog) doesn't double-fire `onAllLoaded`. Identity sync /
        // shared context still need to run for whichever instances DID
        // load — but only when at least one is ready.
        if (enabled.some((s) => s.initialized && !!s.mpRef)) {
          onAllLoaded();
        } else {
          // Nothing loaded — `onAllLoaded` would dispatch register()
          // into the void. Skip; the late `loaded` callback path will
          // run it if/when an instance recovers.
          allLoadedFired = true;
        }
      }, WATCHDOG_MS);
    }

    function clearWatchdog(): void {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    }

    // =====================================================
    // PUBLIC API
    // =====================================================

    // Forward declare to break the cycle: makeInstanceFacade needs a
    // dispatcher function; we provide one that delegates to dispatch().
    const dispatchProxy = (
      op: string,
      args: unknown[],
      options: { instances: InstanceName[] },
    ): boolean => dispatch(op as Parameters<typeof dispatch>[0], args, options);

    const api: MixpanelAPI = {
      configure(
        options?: DeepPartial<DualMixpanelConfig> | DeepPartial<MixpanelConfig>,
      ): DualMixpanelConfig {
        if (options && typeof options === 'object') {
          const dual: DeepPartial<DualMixpanelConfig> = looksLikeDualShape(options)
            ? (options as DeepPartial<DualMixpanelConfig>)
            : legacyToDualSlice(options as DeepPartial<MixpanelConfig>);
          applyConfig(CONFIG, dual);
          // Reflect into state registry immediately so namespaced facades
          // and setEnabled() see the latest enabled flags before init().
          applyDualConfig(CONFIG);
        }
        return legacyProjectionFromDual(CONFIG);
      },

      init(): void {
        initAll();
      },

      setEnabled(instance: InstanceName, enabled: boolean): void {
        setStateEnabled(instance, enabled);
      },

      getConfig(): DualMixpanelConfig {
        return legacyProjectionFromDual(CONFIG);
      },

      // -------- Functional core --------
      track: (event, properties, options) => dispatch('track', [event, properties], options),
      identify: (id, options) => dispatch('identify', [id], options),
      register: (props, options) => dispatch('register', [props], options),
      register_once: (props, options) => dispatch('register_once', [props], options),
      unregister: (prop, options) => dispatch('unregister', [prop], options),
      alias: (id, original, options) => dispatch('alias', [id, original], options),
      reset: (options) => {
        const ok = dispatch('reset', [], options);
        // After both instances reset, re-pin secondary's device_id to
        // primary's freshly-generated UUID so the new anonymous state
        // stays correlated across projects.
        const secondary = getState('secondary');
        if (secondary.enabled && secondary.mpRef) {
          syncIdentityFromPrimary(secondary.mpRef);
        }
        return ok;
      },
      opt_in_tracking: (options) => dispatch('opt_in_tracking', [], options),
      opt_out_tracking: (options) => dispatch('opt_out_tracking', [], options),
      people: {
        set: (props, options) => dispatch('people.set', [props], options),
        set_once: (props, options) => dispatch('people.set_once', [props], options),
        increment: (props, by, options) => dispatch('people.increment', [props, by], options),
        append: (props, options) => dispatch('people.append', [props], options),
        union: (props, options) => dispatch('people.union', [props], options),
        unset: (props, options) => dispatch('people.unset', [props], options),
        track_charge: (amount, props, options) =>
          dispatch('people.track_charge', [amount, props], options),
      },

      // -------- Namespaced sugar --------
      primary: makeInstanceFacade('primary', dispatchProxy),
      secondary: makeInstanceFacade('secondary', dispatchProxy),

      // -------- Utility --------
      getMixpanelCookieData(instance?: InstanceName): Record<string, unknown> {
        const name: InstanceName = instance || 'primary';
        const token = getState(name).config.token;
        if (token) {
          // Token-scoped lookup — exact match on mp_<token>_mixpanel.
          return api[name].getCookieData();
        }
        // No token configured for this instance — fall back to legacy
        // regex scan over all mp_*_mixpanel cookies (returns the last
        // matching cookie's parsed data, or {} if none match). Matches
        // the pre-dual-instance behavior so callers that read this for
        // debugging before configure() still get useful output.
        return legacyRegexScanMpCookie();
      },
    };

    /** Legacy regex scan — pre-dual-instance behavior for getMixpanelCookieData
     *  when no token is configured. Returns the LAST matching mp_*_mixpanel
     *  cookie's parsed value. Matches the legacy error-log format so callers
     *  asserting on it (existing tests) keep working.
     *
     *  Iteration order: `document.cookie` ordering is implementation-defined,
     *  so when multiple `mp_*_mixpanel` cookies coexist (dual-instance) the
     *  "last" match is non-deterministic. The token-keyed lookup at
     *  `api.getMixpanelCookieData(name)` is the deterministic API; this
     *  fallback is intentionally lossy for debug-only use before configure()
     *  has run. */
    function legacyRegexScanMpCookie(): Record<string, unknown> {
      let mixpanelData: Record<string, unknown> = {};
      const regex = /^mp_([a-zA-Z0-9]+)_mixpanel$/i;
      try {
        doc.cookie.split(/\s*;\s*/).forEach(function (pair: string) {
          const parts = pair.split(/\s*=\s*/);
          const name = decodeURIComponent(parts[0]);
          /*! v8 ignore start */
          if (regex.test(name)) {
          /*! v8 ignore stop */
            const value = decodeURIComponent(parts.slice(1).join('='));
            mixpanelData = ppLib.Security.json.parse(value, {} as Record<string, unknown>);
          }
        });
      } catch (e) {
        ppLib.log('error', 'getMixpanelCookieData error', ppLib.safeLogError(e));
      }
      return mixpanelData;
    }

    // Reset cross-module state BEFORE wiring — IIFE re-loads (used by
    // tests via loadWithCommon('mixpanel')) re-evaluate this IIFE but
    // module-scoped state in dispatch/instance-state/session/pre-init-queue
    // persists across ES-module-import boundaries. Without reset, test N+1
    // sees test N's buffered queue / session ID / instance refs.
    resetInstanceState();
    resetSession();
    resetQueue();
    allLoadedFired = false;

    // Wire module-scoped state immediately so dispatch (incl. pre-init
    // buffering) works even before ppLib.mixpanel.init() runs. Tests that
    // mock window.mixpanel directly and call track() without init() rely
    // on this — see the window-mixpanel fallback in dispatch.resolveMpRef.
    applyDualConfig(CONFIG);
    configureLoader(ppLib, CONFIG.shared);
    configureDispatcher(ppLib, CONFIG.shared);
    configureSession(ppLib, CONFIG.shared.sessionTimeout);
    configureCampaign(ppLib);
    configureSharedContext(ppLib, CONFIG.shared.cookieNames);
    configureCookieMigration(ppLib);
    configureIdentitySync(ppLib);

    ppLib.mixpanel = api;
    ppLib.log('info', M.MODULE_LOADED);
  } // end initModule

  bootstrapModule(win, initModule);
})(window, document);
