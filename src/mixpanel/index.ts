/**
 * pp-analytics-lib: Mixpanel Module
 * Mixpanel SDK loader, session management, UTM attribution, and identity.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.mixpanel
 */
import type { PPLib } from '@src/types/common.types';
import type { MixpanelConfig } from '@src/types/mixpanel.types';
import type { DeepPartial } from '@src/types/utility.types';
import type { MixpanelGlobal } from '@src/types/window';
import { pollUntil } from '@src/common/retry';
import { bootstrapModule } from '@src/common/bootstrap';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION (overridable via ppLib.mixpanel.configure)
  // =====================================================

  const CONFIG: MixpanelConfig = {
    enabled: true,
    token: '',
    projectName: '',
    crossSubdomainCookie: true,
    optOutByDefault: false,
    sessionTimeout: 1800000, // 30 minutes in ms
    cookieNames: {
      userId: 'userId',
      ipAddress: 'ipAddress',
      experiments: 'exp'
    },
    enrichTrack: true,
    // 'flat' default — per the Analytics events spec, Mixpanel receives a
    // flat key shape (no nested page/userProperties/eventProperties/
    // attribution wrappers). dataLayer / GTM still gets the nested GA4
    // shape via its own enricher. Callers that want both can override
    // to 'dual'. See MixpanelConfig.emitMode docs.
    emitMode: 'flat'
  };

  // =====================================================
  // INTERNAL TRACK FACADE
  // All SDK-internal Mixpanel events flow through this to pick up the
  // shared event-properties context (UTM touch, device, session, login,
  // marketing attribution, click IDs). Mixpanel super-properties are
  // skipped by the builder to avoid payload duplication.
  // =====================================================

  // Mode dispatch for the per-event property bag.
  //   'flat':   buildFlat() — flat keys only (legacy).
  //   'nested': buildNested() — only page/userProperties/eventProperties/attribution.
  //   'dual':   flat keys + the 4 nested wrappers. The 4 wrapper key names
  //             ('page', 'userProperties', 'eventProperties', 'attribution')
  //             do not collide with any flat field, so a shallow merge is
  //             always lossless.
  // Returns {} when the builder is missing — callers (trackFacade) only
  // invoke this when `ppLib.eventPropertiesBuilder` is present, so this is
  // defensive belt-and-braces. Caller-passed properties are layered on
  // separately and still win on collision.
  function buildForMode(mode: 'flat' | 'dual' | 'nested'): Record<string, unknown> {
    const builder = ppLib.eventPropertiesBuilder;
    if (!builder) return {};
    if (mode === 'flat') return builder.buildFlat();
    if (mode === 'nested') return builder.buildNested();
    // 'dual' — flat is the base; layer the 4 nested wrappers on top.
    const flat = builder.buildFlat();
    const nested = builder.buildNested();
    const nestedKeys = Object.keys(nested);
    for (let i = 0; i < nestedKeys.length; i++) {
      flat[nestedKeys[i]] = nested[nestedKeys[i]];
    }
    return flat;
  }

  function trackFacade(eventName: string, properties?: Record<string, unknown>): boolean {
    try {
      if (!CONFIG.enabled) return false;
      // Consent gate — drop silently on denial. No log noise (would fire
      // on every event during a denied session) and no stub-queue growth.
      if (ppLib.consent && !ppLib.consent.isGranted()) return false;
      const mp = win.mixpanel;
      if (!mp || typeof mp.track !== 'function') return false;
      if (typeof eventName !== 'string' || !eventName) {
        ppLib.log('warn', '[ppMixpanel] track called with empty eventName');
        return false;
      }

      let merged: Record<string, unknown>;
      if (CONFIG.enrichTrack && ppLib.eventPropertiesBuilder) {
        const enriched = buildForMode(CONFIG.emitMode);
        // Caller-wins merge: enriched is the floor, caller's props override.
        merged = enriched;
        if (properties) {
          const keys = Object.keys(properties);
          for (let i = 0; i < keys.length; i++) {
            merged[keys[i]] = properties[keys[i]];
          }
        }
      } else {
        merged = properties || {};
      }

      mp.track(eventName, merged);
      return true;
    } catch (e) {
      ppLib.log('error', '[ppMixpanel] track facade error', ppLib.safeLogError(e));
      return false;
    }
  }

  // =====================================================
  // MIXPANEL SDK LOADER
  // =====================================================

  // Mixpanel JS SDK loader stub v1.2 (synced from cdn.mxpnl.com/libs/mixpanel-2-latest.min.js)
  // Last verified: 2026-05-07
  //
  // Restructured from the upstream `var`-based snippet to use `let`/`const`.
  // The two block-scope hazards in the original — (1) `d` declared inside a
  // `try` block but reassigned/used after it, and (2) `b`/`d`/`call2_args`/
  // `call2` declared in a `for`-init but closed over by a sibling inner
  // function `a()` — are resolved by hoisting those declarations to the
  // enclosing scope. Behavior is identical: same stub queue, same method
  // shadowing, same async script injection.
  //
  // Local additions (not from upstream):
  //   - CONFIG.cdnUrl override on the `b.src =` line so callers can pin
  //     a specific Mixpanel SDK version for SRI.
  //   - SRI / crossOrigin / requireIntegrity gate after `b.src =` (mirrors
  //     the Braze loader). Default is warn-only — see BrazeSdkConfig docs
  //     for the Phase-1 → Phase-3 rollout rationale.
  function loadMixpanelSDK(): void {
    /*! v8 ignore start */
    if ((win as any).mixpanel && (win as any).mixpanel.__SV) return;
    /*! v8 ignore stop */

    const c: any = doc;
    /*! v8 ignore start */
    const a: any = (win as any).mixpanel || [];

    if (!a.__SV) {
    /*! v8 ignore stop */
      // SRI gate runs BEFORE stub installation so a fail-closed refusal
      // doesn't leave window.mixpanel as a stub queue that callers silently
      // fill forever (mirrors the Braze loader; see sdk-loader.ts).
      if (CONFIG.integrity) {
        if (!/^(sha256|sha384|sha512)-[A-Za-z0-9+/=]+$/.test(CONFIG.integrity)) {
          ppLib.log('error', '[ppMixpanel] integrity hash format invalid — expected sha256|sha384|sha512-<base64>; refusing to load');
          return;
        }
      } else if (CONFIG.requireIntegrity) {
        ppLib.log('error', '[ppMixpanel] requireIntegrity=true but no integrity hash configured — refusing to load');
        return;
      } else {
        ppLib.log('warn', '[ppMixpanel] Loading SDK without SRI integrity — set CONFIG.integrity (with a pinned cdnUrl) for hardening');
      }

      let b: any = win;
      // `d` starts as the hash-state extractor function (assigned inside the
      // try below), then is reassigned to the first <script> element after
      // the try. Hoisted out so it survives the block scope.
      let d: any;
      try {
        let m: any;
        let j: any;
        const k = b.location;
        const f = k.hash;
        d = function(a: any, b: any) {
          return (m = a.match(RegExp(b + '=([^&]*)'))) ? m[1] : null;
        };
        f && d(f, 'state') &&
          ((j = JSON.parse(decodeURIComponent(d(f, 'state')))),
          'mpeditor' === j.action &&
            (b.sessionStorage.setItem('_mpcehash', f),
            history.replaceState(j.desiredHash || '', c.title, k.pathname + k.search)));
      } catch (n) {}

      let l: any;
      let h: any;
      (win as any).mixpanel = a;
      a._i = [];
      a.init = function(b: any, d: any, g: any) {
        function c(b: any, i: any) {
          const a = i.split('.');
          2 == a.length && ((b = b[a[0]]), (i = a[1]));
          b[i] = function() {
            b.push([i].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        let e = a;
        'undefined' !== typeof g ? (e = a[g] = []) : (g = 'mixpanel');
        e.people = e.people || [];
        e.toString = function(b: any) {
          let a = 'mixpanel';
          'mixpanel' !== g && (a += '.' + g);
          b || (a += ' (stub)');
          return a;
        };
        e.people.toString = function() {
          return e.toString(1) + '.people (stub)';
        };
        l = 'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(' ');
        for (h = 0; h < l.length; h++) c(e, l[h]);
        const f = 'set set_once union unset remove delete'.split(' ');
        e.get_group = function() {
          // Hoisted out of the for-init so the inner `function a()` (declared
          // outside the loop body) can close over them — preserves the
          // original `var`-hoisting semantics under block scope.
          const groupArgs = ['get_group'].concat(Array.prototype.slice.call(arguments, 0));
          const groupShadow: any = {};
          let call2_args: any;
          let call2: any;

          function a(c: any) {
            groupShadow[c] = function() {
              call2_args = arguments;
              call2 = [c].concat(Array.prototype.slice.call(call2_args, 0));
              e.push([groupArgs, call2]);
            };
          }
          for (let c = 0; c < f.length; c++) a(f[c]);
          return groupShadow;
        };
        a._i.push([b, d, g]);
      };
      a.__SV = 1.2;
      b = c.createElement('script');
      b.type = 'text/javascript';
      b.async = !0;
      b.src = CONFIG.cdnUrl || 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
      /*! v8 ignore start — vendored Mixpanel SDK snippet, IIFE source map can't attribute nonce branch */
      if (CONFIG.nonce) b.setAttribute('nonce', CONFIG.nonce);
      /*! v8 ignore stop */
      if (CONFIG.integrity) {
        b.integrity = CONFIG.integrity;
        // crossOrigin is required for SRI enforcement on cross-origin scripts.
        b.crossOrigin = CONFIG.crossOrigin || 'anonymous';
      }
      // Surface SRI mismatches and network failures — without an onerror handler
      // a stale integrity hash silently breaks Mixpanel for every page load.
      b.onerror = function() {
        ppLib.log('error', '[ppMixpanel] Failed to load SDK from ' + b.src + ' (SRI mismatch, network error, or blocker?)');
      };
      d = c.getElementsByTagName('script')[0];
      d.parentNode.insertBefore(b, d);
    }
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  // Module-local reference to the global Mixpanel instance. Populated by
  // loadMixpanelSDK (stub queue) before SessionManager is ever invoked, then
  // replaced with the real SDK from inside the `loaded` callback. The
  // SessionManager methods below all run after that assignment, so the
  // non-null assertions are correct under the runtime contract.
  let mixpanel: MixpanelGlobal | undefined;

  function mp(): MixpanelGlobal {
    if (!mixpanel) {
      throw new Error('[ppMixpanel] SessionManager invoked before init');
    }
    return mixpanel;
  }

  const SessionManager = {
    timeout: CONFIG.sessionTimeout,

    generateId: function(): string {
      function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
          .toString(16)
          .substring(1);
      }
      return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    },

    setId: function(): void {
      mp().register({ 'session ID': this.generateId() });
    },

    check: function(): void {
      const m = mp();
      /*! v8 ignore start */
      if (!m.get_property('last event time')) {
      /*! v8 ignore stop */
        this.setId();
      }
      /*! v8 ignore start */
      if (!m.get_property('session ID')) {
      /*! v8 ignore stop */
        this.setId();
      }
      const lastEventTime = m.get_property('last event time');
      /*! v8 ignore start */
      if (typeof lastEventTime === 'number' && Date.now() - lastEventTime > this.timeout) {
      /*! v8 ignore stop */
        this.setId();
        resetCampaign();
      }
    }
  };

  // =====================================================
  // CAMPAIGN / UTM ATTRIBUTION
  // =====================================================

  const CAMPAIGN_KEYWORDS = 'utm_source utm_medium utm_campaign utm_content utm_term'.split(' ');

  // VWO experiment-props bridging — total cap = 30 attempts * 500ms = 15s
  // (matches the VWO module's EXPERIMENT_POLL_* constants).
  const VWO_BRIDGE_POLL_MAX_ATTEMPTS = 30;
  const VWO_BRIDGE_POLL_INTERVAL_MS = 500;

  // Per the Analytics UTM events spec, every utm_* [first/last touch] key
  // defaults to '$direct' when no value is set. Applied uniformly across
  // [first touch] / [last touch] / session-reset so direct visits produce
  // stable, queryable values rather than empty strings or missing keys.
  function fallbackForKeyword(_keyword: string): string {
    return '$direct';
  }

  // Read utm_* values from the shared event-properties builder. The builder
  // tracks LITERAL `utm_*` URL params (no normalization), so traffic that
  // uses non-utm aliases like `?source=febpt` does not pollute these
  // super-properties. The attribution service's normalized values still flow
  // separately into the `marketingAttribution` super-property.
  type UtmTouch = { utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string };

  function emptyUtmTouch(): UtmTouch {
    return { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };
  }

  function buildTouchParams(touch: UtmTouch, suffix: '[first touch]' | '[last touch]'): Record<string, string> {
    const params: Record<string, string> = {};
    for (let i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
      const kw = CAMPAIGN_KEYWORDS[i] as keyof UtmTouch;
      params[kw + ' ' + suffix] = touch[kw] || fallbackForKeyword(kw);
    }
    return params;
  }

  function resetCampaign(): void {
    // Session reset: clear last-touch attribution to canonical defaults.
    const m = mp();
    const params = buildTouchParams(emptyUtmTouch(), '[last touch]');
    m.people.set(params);
    m.register(params);
  }

  function campaignParams(): void {
    // Source utm_* from the builder (literal URL params + first/last touch
    // persistence). Falls back to direct URL extraction if the builder isn't
    // wired up (defensive — common module always installs it).
    const builder = ppLib.eventPropertiesBuilder;
    const firstTouch: UtmTouch = builder ? builder.getFirstTouchUtm() as UtmTouch : emptyUtmTouch();
    const lastTouch: UtmTouch = builder ? builder.getLastTouchUtm() as UtmTouch : emptyUtmTouch();

    const lastParams = buildTouchParams(lastTouch, '[last touch]');
    const firstParams = buildTouchParams(firstTouch, '[first touch]');

    const url = doc.URL;
    const gclid = ppLib.getQueryParam(url, 'gclid');
    /*! v8 ignore start */
    if (gclid.length) {
    /*! v8 ignore stop */
      lastParams['gclid'] = gclid;
    }

    const fbclid = ppLib.getQueryParam(url, 'fbclid');
    /*! v8 ignore start */
    if (fbclid.length) {
    /*! v8 ignore stop */
      lastParams['fbclid'] = fbclid;
    }

    const m = mp();
    m.people.set(lastParams);
    m.register(lastParams);
    // 3C: first-touch is a snapshot taken at the first-ever capture and
    // locked thereafter. The builder enforces this on the SDK side via
    // its persistence layer; Mixpanel's `register_once` / `set_once`
    // adds defense-in-depth so even a reseeded builder (cookie cleared,
    // module re-initialized) cannot overwrite the first-touch values
    // already on a Mixpanel profile.
    m.people.set_once(firstParams);
    m.register_once(firstParams);
  }

  // =====================================================
  // MIXPANEL COOKIE DATA READER
  // =====================================================

  function getMixpanelCookieData(): Record<string, unknown> {
    let mixpanelData: Record<string, unknown> = {};
    const regex = /^mp_([a-zA-Z0-9]+)_mixpanel$/i;

    try {
      doc.cookie.split(/\s*;\s*/).forEach(function(pair: string) {
        const parts = pair.split(/\s*=\s*/);
        const name = decodeURIComponent(parts[0]);
        /*! v8 ignore start */
        if (regex.test(name)) {
        /*! v8 ignore stop */
          const value = decodeURIComponent(parts.splice(1).join('='));
          mixpanelData = ppLib.Security.json.parse(value, {} as Record<string, unknown>);
        }
      });
    } catch (e) {
      ppLib.log('error', 'getMixpanelCookieData error', ppLib.safeLogError(e));
    }

    return mixpanelData;
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function initMixpanel(): void {
    /*! v8 ignore start */
    if (!CONFIG.enabled) {
    /*! v8 ignore stop */
      ppLib.log('info', '[ppMixpanel] Module disabled via config');
      return;
    }

    /*! v8 ignore start */
    if (!CONFIG.token) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppMixpanel] No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.');
      return;
    }

    loadMixpanelSDK();
    // SRI fail-closed (or invalid integrity format) returns from loadMixpanelSDK
    // before installing the window.mixpanel stub. Bail out here so we don't call
    // mp().init() against an undefined global — the error log was already emitted
    // by the SRI gate.
    if (!win.mixpanel) return;
    mixpanel = win.mixpanel;

    // Read the distinct_id from any existing Mixpanel cookie BEFORE init.
    // After init with cross_subdomain_cookie: true, Mixpanel will create a new
    // parent domain cookie. If the distinct_id changed (subdomain cookie wasn't
    // readable from the parent domain), we re-identify to preserve continuity.
    //
    // This approach is safe because:
    //   - We never delete any cookies ourselves (no browser inconsistency risk)
    //   - We only call mp.identify() for identified users (not $device: anonymous)
    //   - We compare before/after distinct_ids to detect actual migration
    //   - sessionStorage flag prevents re-checking after first page load
    let preInitDistinctId: string | null = null;
    if (CONFIG.crossSubdomainCookie && CONFIG.token) {
      try {
        const migrationKey = 'pp_mp_migrated';
        let alreadyMigrated = false;
        try { alreadyMigrated = win.sessionStorage.getItem(migrationKey) === '1'; } catch (e) { /* no sessionStorage */ }

        if (!alreadyMigrated) {
          const mpCookieName = 'mp_' + CONFIG.token + '_mixpanel';
          const mpCookie = ppLib.getCookie(mpCookieName);
          if (mpCookie) {
            const parsed = ppLib.Security.json.parse(mpCookie);
            if (parsed && typeof parsed === 'object' && 'distinct_id' in parsed) {
              const id = (parsed as { distinct_id: unknown }).distinct_id;
              if (id !== undefined && id !== null) preInitDistinctId = String(id);
            }
          }
          try { win.sessionStorage.setItem(migrationKey, '1'); } catch (e) { /* no sessionStorage */ }
        }
      } catch (e) {
        ppLib.log('warn', '[ppMixpanel] Pre-init cookie read error', e);
      }
    }

    mp().init(CONFIG.token, {
      cross_subdomain_cookie: CONFIG.crossSubdomainCookie,
      opt_out_tracking_by_default: CONFIG.optOutByDefault,
      api_transport: 'sendBeacon',
      // Suppress Mixpanel's built-in autotrack "Page View" event. The SDK
      // already fires its own `pageview` event through the analytics
      // module (with our enriched property bag), so leaving Mixpanel's
      // autotrack on would produce two pageviews per visit — one with
      // canonical context and one without. The autotrack also bypasses
      // our 3E stripping, leaking empty-string super-properties into the
      // event payload. Default-off matches Mixpanel's pre-2024 behavior.
      track_pageview: false,
      // Mixpanel's built-in marketing attribution stays enabled (default
      // behavior). It auto-captures utm_* (source, medium, campaign,
      // content, term, id) and click IDs (gclid, fbclid, etc.) from the
      // current URL and surfaces them as event properties — visible in
      // the Mixpanel UI as "UTM Source", "UTM Medium", "UTM Campaign",
      // "UTM Content", "UTM Term", "UTM ID". The SDK additionally
      // registers `utm_* [first touch]` / `utm_* [last touch]` as
      // bracketed super-properties via campaignParams() for canonical
      // attribution analysis; the plain Mixpanel-auto columns coexist
      // for ad-hoc filtering / segment exploration.
      // Mixpanel's $-prefixed auto-properties ($browser, $current_url,
      // $device, $initial_referrer, etc.) display in the Mixpanel UI as
      // title-case ("Browser", "Current URL", "Device", "Initial
      // Referrer") and are the canonical values per the data team's
      // reference event shape. The SDK's duplicate snake_case fields
      // (`browser`, `device`, `current_url`, etc.) are stripped from
      // the Mixpanel payload by `MIXPANEL_DUPLICATE_KEYS` in the
      // event-properties builder. dataLayer / GTM still receives the
      // snake_case fields unchanged.
      loaded: function(mp: MixpanelGlobal) {
        mixpanel = mp;
        if (!CONFIG.optOutByDefault) {
          mp.opt_in_tracking();
        }

        // Check if distinct_id changed after init (indicates subdomain → parent migration).
        // Mixpanel init with cross_subdomain_cookie: true reads the parent domain cookie.
        // If the user only had a subdomain cookie, Mixpanel won't find it and will
        // generate a new distinct_id. We detect this by comparing before/after.
        if (preInitDistinctId) {
          const postInitDistinctId = mp.get_distinct_id ? mp.get_distinct_id() : null;

          if (postInitDistinctId && postInitDistinctId !== preInitDistinctId) {
            // distinct_id changed → subdomain cookie wasn't picked up by parent domain init.
            if (preInitDistinctId.indexOf('$device:') === 0) {
              // Anonymous user: can't call mp.identify() with $device: prefix.
              // User gets a new anonymous ID. Events merge when they later log in.
              ppLib.log('info', '[ppMixpanel] Anonymous subdomain user migrated (old: ' + preInitDistinctId + ', new: ' + postInitDistinctId + ')');
            } else {
              // Identified user: re-identify to preserve profile continuity.
              mp.identify(preInitDistinctId);
              ppLib.log('info', '[ppMixpanel] Identified user migrated (distinct_id: ' + preInitDistinctId + ')');
            }
          }
          // If distinct_id is the same, cookie was already on parent domain — no action needed.
        }

        // Unify Mixpanel's distinct_id with the SDK's pp_distinct_id so
        // cross-tool reports (Mixpanel ↔ Braze ↔ GA4) join cleanly without
        // translation. Logged-in users get pp_user_id; anonymous users get
        // the SDK's device_id. Skipped if the IDs already match (post-migration
        // identified users, or anonymous users we previously identified).
        try {
          if (ppLib.eventPropertiesBuilder) {
            const bundle = ppLib.eventPropertiesBuilder.build();
            const ppDistinctId = bundle.userProperties.pp_distinct_id;
            const currentMpId = typeof mp.get_distinct_id === 'function' ? mp.get_distinct_id() : null;
            if (ppDistinctId && currentMpId !== ppDistinctId) {
              mp.identify(ppDistinctId);
              ppLib.log('info', '[ppMixpanel] Unified Mixpanel distinct_id with pp_distinct_id (was: ' + currentMpId + ', now: ' + ppDistinctId + ')');
            }
          }
        } catch (e) {
          ppLib.log('warn', '[ppMixpanel] distinct_id unification failed', e);
        }

        // Update session timeout from config
        SessionManager.timeout = CONFIG.sessionTimeout;

        // Check/set session
        SessionManager.check();

        // Monkey-patch track() to always check session.
        // Uses stored original to prevent wrapper nesting across re-inits.
        // The `_ppOriginal` augmentation is our own runtime addition; cast
        // to AugmentedTrack at the access boundary.
        type AugmentedTrack = MixpanelGlobal['track'] & {
          _ppOriginal?: MixpanelGlobal['track'];
        };
        const augmented = mp.track as AugmentedTrack;
        const originalTrack: MixpanelGlobal['track'] = augmented._ppOriginal || mp.track;
        // Variadic forwarding preserves any 3rd+ args Mixpanel adds in
        // future SDK versions (callbacks, options, etc.).
        const wrappedTrack: AugmentedTrack = function(this: MixpanelGlobal, ...args: unknown[]): void {
          SessionManager.check();
          mp.register({ 'last event time': Date.now() });
          (originalTrack as (...a: unknown[]) => void).apply(mp, args);
        } as AugmentedTrack;
        wrappedTrack._ppOriginal = originalTrack;
        mp.track = wrappedTrack;
        ppLib._mpTrackPatched = true;

        // Register base properties
        const baseProps: Record<string, unknown> = {
          'last event time': Date.now(),
          pp_user_agent: win.navigator.userAgent
        };

        /*! v8 ignore start */
        if (CONFIG.projectName) {
        /*! v8 ignore stop */
          baseProps.project = CONFIG.projectName;
        }

        mp.register(baseProps);

        // Cookie-based identity
        const userId = ppLib.getCookie(CONFIG.cookieNames.userId);
        /*! v8 ignore start */
        if (userId) {
        /*! v8 ignore stop */
          mp.register({ pp_user_id: userId });
        }

        const ipAddress = ppLib.getCookie(CONFIG.cookieNames.ipAddress);
        /*! v8 ignore start */
        if (ipAddress) {
        /*! v8 ignore stop */
          mp.register({ pp_user_ip: ipAddress });
        }

        // Experiment cookie
        const expCookie = ppLib.getCookie(CONFIG.cookieNames.experiments);
        /*! v8 ignore start */
        if (expCookie) {
        /*! v8 ignore stop */
          const expJson = ppLib.Security.json.parse(expCookie);
          /*! v8 ignore start */
          if (expJson && typeof expJson === 'object') {
          /*! v8 ignore stop */
            const expObj = expJson as Record<string, unknown>;
            const data: Record<string, unknown> = {};
            Object.keys(expObj).forEach(function(item: string) {
              data[item] = expObj[item];
            });
            mp.people.set_once(data);
            mp.register(data);
          }
        }

        // UTM attribution
        campaignParams();

        // marketingAttribution super-property registration. We're inside
        // `loaded`, so mp is guaranteed live — no polling needed. Reads
        // the resolved normalized last-touch from the shared builder,
        // which has already applied the session-veto + self-referral
        // rules in captureUtmTouches.
        try {
          if (ppLib.eventPropertiesBuilder) {
            const marketingAttribution = ppLib.eventPropertiesBuilder.getMarketingAttribution();
            if (marketingAttribution) {
              mp.register({ marketingAttribution: marketingAttribution });
              if (typeof mp.people.set === 'function') {
                mp.people.set({ marketingAttribution: marketingAttribution });
              }
              ppLib.log('info', '[ppMixpanel] Registered marketingAttribution super-property');
            }
          }
        } catch (e) {
          ppLib.log('warn', '[ppMixpanel] Failed to register marketingAttribution super-property', e);
        }

        // VWO experiment properties — register as super properties so they
        // appear on every subsequent event (page view, add to cart, purchase).
        // Read from ppLib (set by VWO module) or sessionStorage (persisted).
        let vwoRegistered = false;
        let vwoPoll: { cancel: () => void } | null = null;

        function readVWOProps(): Record<string, string> | null {
          const props = ppLib._vwoExperimentProps;
          if (props && typeof props === 'object') return props;
          try {
            const stored = win.sessionStorage.getItem('pp_vwo_exp_props');
            if (stored) {
              const parsed = ppLib.Security.json.parse(stored);
              if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
            }
          } catch (e) { /* no sessionStorage */ }
          return null;
        }

        function registerVWOProps(): boolean {
          if (vwoRegistered) return true;
          try {
            const props = readVWOProps();
            if (props) {
              mp.register(props);
              if (typeof mp.people.set === 'function') {
                mp.people.set(props);
              }
              vwoRegistered = true;
              ppLib.log('info', '[ppMixpanel] VWO experiment properties registered');
              if (vwoPoll) {
                vwoPoll.cancel();
                vwoPoll = null;
              }
              return true;
            }
          } catch (e) {
            ppLib.log('warn', '[ppMixpanel] Failed to register VWO experiment properties', e);
          }
          return false;
        }

        // Try immediately — VWO may have already set props
        registerVWOProps();

        // If VWO hasn't fired yet, use both queue and polling to catch it
        if (!vwoRegistered) {
          // Strategy 1: VWO queue callback
          win._vis_opt_queue = win._vis_opt_queue || [];
          win._vis_opt_queue.push(function() {
            registerVWOProps();
          });

          // Strategy 2: Poll for ppLib._vwoExperimentProps
          vwoPoll = pollUntil({
            check: registerVWOProps,
            intervalMs: VWO_BRIDGE_POLL_INTERVAL_MS,
            maxAttempts: VWO_BRIDGE_POLL_MAX_ATTEMPTS,
            win
          });
        }

        ppLib.log('info', '[ppMixpanel] Initialized successfully');
      }
    });
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.mixpanel = {
    configure: function(options?: DeepPartial<MixpanelConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: function(): void {
      initMixpanel();
    },

    track: trackFacade,

    getMixpanelCookieData: getMixpanelCookieData,

    getConfig: function() {
      return JSON.parse(JSON.stringify(CONFIG));
    }
  };

  ppLib.log('info', '[ppMixpanel] Module loaded');

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
