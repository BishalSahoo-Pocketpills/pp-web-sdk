/**
 * Shared Marketing Attribution Service
 *
 * Single source of truth for marketing attribution data across all SDK modules.
 * Extracts query params once, builds a curated summary, stores first/last touch,
 * and exposes a unified marketingAttribution object for event enrichment.
 *
 * Used by: Analytics, DataLayer, EventSource, Mixpanel
 */
import type { PPLib } from '@src/types/common.types';
import type { DeepPartial } from '@src/types/utility.types';
import { pollUntil } from '@src/common/retry';
import { createPersistentValue } from '@src/common/persistent-storage';
import {
  buildNormalizedTouch,
  extractParams,
  hasNewTrafficParams,
  type NormalizedTouch,
} from '@src/common/event-properties-builder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Public alias of `NormalizedTouch` (defined in event-properties-builder
 * during the Phase 2 helper move). Re-exported here so the existing public
 * surface from `@src/types/index.ts` keeps working until Phase 4 removes the
 * type exports. Same shape end-to-end.
 */
export type TouchAttribution = NormalizedTouch;

export interface MarketingAttribution extends TouchAttribution {
  firstTouch?: TouchAttribution;
  lastTouch?: TouchAttribution;
}

export interface AttributionServiceConfig {
  includeFirstTouch: boolean;
  includeLastTouch: boolean;
  enrichEvents: boolean;
  sessionTimeoutMs: number;
  persistFirstTouch: boolean;
  /**
   * Legacy localStorage keys retained for the cookie migration window.
   * createPersistentValue treats these as one-time migration sources and
   * deletes them after the first cookie write.
   */
  storageKeyFirst: string;
  storageKeyLast: string;
  storageKeySession: string;
  /** Prefix for the cookie names that replace the localStorage entries. */
  cookiePrefix: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAttributionService(
  win: Window & typeof globalThis,
  ppLib: PPLib,
) {
  const config: AttributionServiceConfig = {
    includeFirstTouch: false,
    includeLastTouch: false,
    enrichEvents: true,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    persistFirstTouch: true,
    storageKeyFirst: 'mktg_first',
    storageKeyLast: 'mktg_last',
    storageKeySession: 'mktg_session',
    cookiePrefix: 'pp_mktg_',
  };

  let cachedCurrent: TouchAttribution | null = null;
  let initialized = false;

  // ---------------------------------------------------------------------------
  // Persistent storage — cross-subdomain cookies (1B/1C migration).
  //
  // First touch: 2 years (long-lived attribution anchor).
  // Last touch:  30 days (matches GA/Mixpanel last-touch window).
  // Session:     30 min (re-anchored on every touchSession()).
  //
  // Each PersistentValue carries a legacyLocalStorageKey so values written by
  // the pre-1C deploy migrate transparently on the next read. Deserializers
  // return null when the parsed JSON lacks required fields (e.g. a stored
  // TouchAttribution missing referrerDomain from before 1C) — the factory
  // treats null as "corrupt" and falls through to legacy/generate (none here).
  // ---------------------------------------------------------------------------

  const FIRST_TOUCH_MAX_AGE = 63072000;  // 2 years
  const LAST_TOUCH_MAX_AGE  = 2592000;   // 30 days
  const SESSION_MAX_AGE     = 1800;      // 30 min

  function parseTouchAttribution(raw: string): TouchAttribution | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const o = parsed as Record<string, unknown>;
      // Required-field shape check — pre-1C entries lack referrerDomain and
      // are treated as corrupt so the cookie self-heals on the next write.
      const required: ReadonlyArray<keyof TouchAttribution> = [
        'source', 'medium', 'campaign', 'platform', 'clickId',
        'landingPage', 'referrer', 'referrerDomain', 'timestamp'
      ];
      for (let i = 0; i < required.length; i++) {
        if (typeof o[required[i] as string] !== 'string') return null;
      }
      return {
        source: o.source as string,
        medium: o.medium as string,
        campaign: o.campaign as string,
        platform: o.platform as string,
        clickId: o.clickId as string,
        landingPage: o.landingPage as string,
        referrer: o.referrer as string,
        referrerDomain: o.referrerDomain as string,
        timestamp: o.timestamp as string,
      };
    } catch (e) {
      return null;
    }
  }

  function parseSession(raw: string): { ts: number } | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const ts = (parsed as Record<string, unknown>).ts;
      if (typeof ts !== 'number') return null;
      return { ts: ts };
    } catch (e) {
      return null;
    }
  }

  const firstTouchStore = createPersistentValue<TouchAttribution>(win, ppLib, {
    cookieName: config.cookiePrefix + 'first_touch',
    maxAgeSeconds: FIRST_TOUCH_MAX_AGE,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseTouchAttribution,
    legacyLocalStorageKey: config.storageKeyFirst,
  });

  const lastTouchStore = createPersistentValue<TouchAttribution>(win, ppLib, {
    cookieName: config.cookiePrefix + 'last_touch',
    maxAgeSeconds: LAST_TOUCH_MAX_AGE,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseTouchAttribution,
    legacyLocalStorageKey: config.storageKeyLast,
  });

  const sessionStore = createPersistentValue<{ ts: number }>(win, ppLib, {
    cookieName: config.cookiePrefix + 'session',
    maxAgeSeconds: SESSION_MAX_AGE,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseSession,
    legacyLocalStorageKey: config.storageKeySession,
  });

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  function configure(options: DeepPartial<AttributionServiceConfig>): void {
    if (options.includeFirstTouch !== undefined) config.includeFirstTouch = options.includeFirstTouch;
    if (options.includeLastTouch !== undefined) config.includeLastTouch = options.includeLastTouch;
    if (options.enrichEvents !== undefined) config.enrichEvents = options.enrichEvents;
    if (options.sessionTimeoutMs !== undefined) config.sessionTimeoutMs = options.sessionTimeoutMs;
    if (options.persistFirstTouch !== undefined) config.persistFirstTouch = options.persistFirstTouch;
  }

  /**
   * Detect whether a referrer is "ours" — same host as current, or any
   * subdomain of the configured cookieDomain root (e.g. `.pocketpills.com`
   * covers `www.pocketpills.com → try.pocketpills.com`).
   *
   * Used by init() to veto last-touch overwrite on refreshes and internal
   * navigations: `document.referrer` after F5 is the same-site URL, which
   * would otherwise mis-attribute last-touch to "pocketpills.com" (issues
   * 3.b and 3.c from the data-team audit).
   *
   * Conservative on parse errors: an unparseable referrer is treated as
   * NOT a self-referral (so the normal last-touch logic runs). Empty
   * referrer is also not a self-referral — that's a direct visit.
   */
  function isSelfReferral(referrer: string, w: Window): boolean {
    if (!referrer) return false;
    let refHost: string;
    try {
      refHost = new URL(referrer).hostname;
    } catch (e) {
      return false;
    }
    if (!refHost) return false;

    const currentHost = w.location.hostname;
    if (refHost === currentHost) return true;

    // Cross-subdomain self-referral: any host matching the cookie domain root.
    // cookieDomain conventionally starts with a leading dot (`.pocketpills.com`);
    // strip it before the suffix check.
    const cookieDomain = ppLib.config && ppLib.config.cookieDomain;
    if (typeof cookieDomain === 'string' && cookieDomain.length > 0) {
      const root = cookieDomain.charAt(0) === '.' ? cookieDomain.slice(1) : cookieDomain;
      if (root && (refHost === root || refHost.endsWith('.' + root))) return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  function isSessionActive(): boolean {
    const session = sessionStore.read();
    if (!session || typeof session.ts !== 'number') return false;
    const elapsed = Date.now() - session.ts;
    return elapsed < config.sessionTimeoutMs;
  }

  function touchSession(): void {
    sessionStore.write({ ts: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // Storage (first/last touch) — domain-scoped cookies via PersistentValue.
  // Legacy `mktg_*` localStorage entries are migrated transparently on first
  // read (see the PersistentValue factory in common/persistent-storage.ts).
  // ---------------------------------------------------------------------------

  /**
   * First-touch immutability contract.
   *
   * First touch is written exactly ONCE per browser (per cookie horizon)
   * and is never overwritten — not on re-init, not on a new session, not
   * on a new UTM-bearing landing. The `if (!existing)` guard below is the
   * load-bearing line; do not remove it without a corresponding data-team
   * sign-off. This guarantees `utm_source[first touch]` reflects the
   * acquisition channel, not the most recent campaign.
   *
   * To intentionally reset (e.g. on consent revocation), use `clear()`.
   */
  function storeFirstTouch(touch: TouchAttribution): void {
    const existing = firstTouchStore.read();
    if (!existing) {
      firstTouchStore.write(touch);
      ppLib.log('info', '[ppAttribution] First touch stored: ' + touch.platform + ' / ' + touch.source);
    }
  }

  function storeLastTouch(touch: TouchAttribution): void {
    lastTouchStore.write(touch);
    ppLib.log('info', '[ppAttribution] Last touch stored: ' + touch.platform + ' / ' + touch.source);
  }

  function getFirstTouch(): TouchAttribution | null {
    return firstTouchStore.read();
  }

  function getLastTouch(): TouchAttribution | null {
    return lastTouchStore.read();
  }

  // ---------------------------------------------------------------------------
  // Initialize — extract params, store touches
  // ---------------------------------------------------------------------------

  function init(): void {
    if (initialized) return;
    initialized = true;

    const params = extractParams(win, ppLib);
    const current = buildNormalizedTouch(win, params);
    const hasNewParams = hasNewTrafficParams(params);
    const sessionActive = isSessionActive();

    // Always update current session cache
    cachedCurrent = current;

    // Store first touch (only if not already stored)
    storeFirstTouch(current);

    // Update last touch only if:
    // 1. New marketing params detected (user arrived from a new campaign), OR
    // 2. Session has expired AND the referrer is NOT a self-referral.
    //
    // Self-referral filter (branch 2 / audit issues 3.b + 3.c): pressing
    // refresh on a signup page leaves `document.referrer` pointing at the
    // same site, which would otherwise flip `utm_source[last touch]` to
    // "pocketpills.com" once the 30-min session expires. We veto that
    // overwrite — last touch stays whatever earned it.
    //
    // hasNewParams still beats the self-referral veto: a fresh UTM is strong
    // signal the user is mid-campaign, even if they bounced internally.
    const referrerUrl = (win.document && win.document.referrer) || '';
    const selfReferral = isSelfReferral(referrerUrl, win);
    if (hasNewParams || (!sessionActive && !selfReferral)) {
      storeLastTouch(current);
    } else {
      if (!hasNewParams && !sessionActive && selfReferral) {
        ppLib.log('info', '[ppAttribution] self-referral detected — last-touch unchanged (referrer=' +
          referrerUrl + ', host=' + win.location.hostname + ')');
      }
      // INVARIANT: when last-touch is vetoed (self-referral OR same session
      // with no new params), `cachedCurrent` is restored from the persisted
      // last-touch so that:
      //   - `getCurrent()` returns the SAME values that downstream sees in
      //     `getLastTouch()` (no drift between in-memory + persisted state).
      //   - `registerMixpanelAttribution()` below reads `cachedCurrent` and
      //     therefore registers the stable last-touch as Mixpanel's super-
      //     property (not the just-built `current`, which carries a
      //     transient self-referral that we deliberately rejected).
      // A future maintainer "optimizing away" this restoration would
      // silently break that Mixpanel super-property invariant.
      const existingLast = getLastTouch();
      if (existingLast) cachedCurrent = existingLast;
    }

    // Touch session
    touchSession();

    // Register Mixpanel super property (dataLayer enrichment is now via the
    // enricher HOF). Reads `cachedCurrent`, which after the block above is
    // the canonical last-touch — see invariant comment.
    registerMixpanelAttribution();

    ppLib.log('info', '[ppAttribution] Initialized — platform: ' + current.platform + ', source: ' + current.source +
      (hasNewParams ? ' (new params)' : sessionActive ? ' (existing session)' : ' (new session)'));
  }

  // ---------------------------------------------------------------------------
  // Public API: get the marketingAttribution object
  // ---------------------------------------------------------------------------

  function getMarketingAttribution(): MarketingAttribution | null {
    if (!config.enrichEvents) return null;

    const current = cachedCurrent || getLastTouch();
    if (!current) return null;

    const attribution: MarketingAttribution = {
      source: current.source,
      medium: current.medium,
      campaign: current.campaign,
      platform: current.platform,
      clickId: current.clickId,
      landingPage: current.landingPage,
      referrer: current.referrer,
      referrerDomain: current.referrerDomain,
      timestamp: current.timestamp,
    };

    if (config.includeFirstTouch) {
      const first = getFirstTouch();
      if (first) attribution.firstTouch = first;
    }

    if (config.includeLastTouch) {
      const last = getLastTouch();
      if (last) attribution.lastTouch = last;
    }

    return attribution;
  }

  // ---------------------------------------------------------------------------
  // Event enrichment helper — merges marketingAttribution into an event object
  // ---------------------------------------------------------------------------

  function enrichEvent<T extends Record<string, unknown>>(event: T): T & { marketingAttribution?: MarketingAttribution } {
    if (!config.enrichEvents) return event;

    const attribution = getMarketingAttribution();
    if (!attribution) return event;

    // Attach attribution as a new property — safe because callers pass
    // locally-constructed objects (DataLayer enriched, EventSource data).
    // The attribution object is freshly built each call, so no aliasing risk.
    (event as Record<string, unknown>).marketingAttribution = attribution;
    return event as T & { marketingAttribution?: MarketingAttribution };
  }

  // ---------------------------------------------------------------------------
  // DataLayer enricher HOF — composable enrichment via the coordinator.
  // Replaces the former direct dataLayer.push monkey-patch.
  // ---------------------------------------------------------------------------

  type AttributionPushFn = (...args: unknown[]) => number;

  function isEnrichableEvent(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.event === 'string' && !obj.marketingAttribution;
  }

  function getEnricher(): (pushFn: AttributionPushFn) => AttributionPushFn {
    return function withAttribution(pushFn: AttributionPushFn): AttributionPushFn {
      return function(...args: unknown[]): number {
        for (let i = 0; i < args.length; i++) {
          if (isEnrichableEvent(args[i])) {
            enrichEvent(args[i] as Record<string, unknown>);
          }
        }
        return pushFn.apply(null, args);
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Mixpanel super property registration
  // ---------------------------------------------------------------------------

  let mixpanelRegistered = false;

  function registerMixpanelAttribution(): void {
    if (mixpanelRegistered || !config.enrichEvents) return;
    mixpanelRegistered = true;

    try {
      const registerMixpanel = function() {
        const mp = (win as unknown as Record<string, unknown>).mixpanel as Record<string, unknown> | undefined;
        if (!mp || typeof mp.register !== 'function') return false;

        const attribution = getMarketingAttribution();
        if (attribution) {
          (mp.register as Function)({ marketingAttribution: attribution });
          const people = mp.people as Record<string, unknown> | undefined;
          if (people && typeof people.set === 'function') {
            (people.set as Function)({ marketingAttribution: attribution });
          }
          ppLib.log('info', '[ppAttribution] Registered marketingAttribution as Mixpanel super property');
        }
        return true;
      };

      // Mixpanel may not be loaded yet — poll until it is or give up.
      pollUntil({ check: registerMixpanel, intervalMs: 500, maxAttempts: 20, win });
    } catch (e) {
      ppLib.log('warn', '[ppAttribution] Failed to register Mixpanel super property', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Clear stored data (consent revocation)
  // ---------------------------------------------------------------------------

  function clear(): void {
    firstTouchStore.clear();
    lastTouchStore.clear();
    sessionStore.clear();
    cachedCurrent = null;
    initialized = false;
    ppLib.log('info', '[ppAttribution] Attribution data cleared');
  }

  return {
    configure: configure,
    init: init,
    get: getMarketingAttribution,
    enrich: enrichEvent,
    getEnricher: getEnricher,
    getFirstTouch: getFirstTouch,
    getLastTouch: getLastTouch,
    getCurrent: function(): TouchAttribution | null { return cachedCurrent; },
    clear: clear,
  };
}

export type AttributionService = ReturnType<typeof createAttributionService>;
