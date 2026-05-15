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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TouchAttribution {
  source: string;
  medium: string;
  campaign: string;
  platform: string;
  clickId: string;
  /** Full URL of the page that captured this touch (location.href). */
  landingPage: string;
  /** Full URL of the referring page (document.referrer), or '' for direct. */
  referrer: string;
  /** Hostname extracted from referrer ('' for direct or unparseable URLs). */
  referrerDomain: string;
  /** ISO timestamp. */
  timestamp: string;
}

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
// Platform detection from click IDs
// ---------------------------------------------------------------------------

const CLICK_ID_PLATFORM_MAP: ReadonlyArray<{ params: string[]; platform: string }> = [
  { params: ['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid'], platform: 'google_ads' },
  { params: ['fbclid'], platform: 'meta_ads' },
  { params: ['ttclid'], platform: 'tiktok_ads' },
  { params: ['msclkid'], platform: 'microsoft_ads' },
  { params: ['li_fat_id'], platform: 'linkedin_ads' },
  { params: ['twclid'], platform: 'twitter_ads' },
  { params: ['epik'], platform: 'pinterest_ads' },
  { params: ['sccid'], platform: 'snapchat_ads' },
];

// Well-known referrer domains → platform classification
const ORGANIC_SEARCH_DOMAINS = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.'];
const ORGANIC_SOCIAL_DOMAINS = ['facebook.', 'instagram.', 'twitter.', 'x.com', 'linkedin.', 'tiktok.', 'pinterest.', 'reddit.'];

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

  // ---------------------------------------------------------------------------
  // Param extraction (single pass)
  // ---------------------------------------------------------------------------

  function extractParams(): Record<string, string> {
    const params: Record<string, string> = {};
    try {
      const searchParams = new URLSearchParams(win.location.search || '');
      searchParams.forEach(function(value, key) {
        const sanitized = ppLib.Security.sanitize(value);
        if (sanitized) {
          params[key.toLowerCase()] = sanitized;
        }
      });
    } catch (e) {
      ppLib.log('warn', '[ppAttribution] Failed to parse URL params', e);
    }
    return params;
  }

  // ---------------------------------------------------------------------------
  // Platform detection
  // ---------------------------------------------------------------------------

  function detectPlatform(params: Record<string, string>, referrer: string): string {
    // Priority 1: Click ID detection
    for (let i = 0; i < CLICK_ID_PLATFORM_MAP.length; i++) {
      const entry = CLICK_ID_PLATFORM_MAP[i];
      for (let j = 0; j < entry.params.length; j++) {
        if (params[entry.params[j]]) {
          return entry.platform;
        }
      }
    }

    // Priority 2: utm_source mapping
    const utmSource = params.utm_source;
    if (utmSource) {
      const lower = utmSource.toLowerCase();
      const medium = (params.utm_medium || '').toLowerCase();
      const isPaid = medium === 'cpc' || medium === 'cpm' || medium === 'paid_social' || medium === 'paid' || medium === 'ppc';

      // Map known sources — distinguish paid vs organic using utm_medium
      if (lower === 'google') return isPaid ? 'google_ads' : 'google';
      if (lower === 'facebook' || lower === 'fb') return isPaid ? 'meta_ads' : 'facebook';
      if (lower === 'instagram' || lower === 'ig') return isPaid ? 'meta_ads' : 'instagram';
      if (lower === 'tiktok') return isPaid ? 'tiktok_ads' : 'tiktok';
      if (lower === 'bing' || lower === 'microsoft') return isPaid ? 'microsoft_ads' : 'bing';
      if (lower === 'linkedin') return isPaid ? 'linkedin_ads' : 'linkedin';
      if (lower === 'twitter' || lower === 'x') return isPaid ? 'twitter_ads' : 'twitter';
      if (lower === 'pinterest') return isPaid ? 'pinterest_ads' : 'pinterest';
      if (lower === 'snapchat') return isPaid ? 'snapchat_ads' : 'snapchat';
      return lower; // Return raw utm_source for unknown platforms
    }

    // Priority 3: Referrer-based detection
    if (referrer && referrer !== 'direct' && referrer !== 'internal' && referrer !== 'unknown') {
      const refLower = referrer.toLowerCase();
      for (let s = 0; s < ORGANIC_SEARCH_DOMAINS.length; s++) {
        if (refLower.indexOf(ORGANIC_SEARCH_DOMAINS[s]) !== -1) return 'organic_search';
      }
      for (let o = 0; o < ORGANIC_SOCIAL_DOMAINS.length; o++) {
        if (refLower.indexOf(ORGANIC_SOCIAL_DOMAINS[o]) !== -1) return 'organic_social';
      }
      return 'referral';
    }

    return 'direct';
  }

  function extractClickId(params: Record<string, string>): string {
    for (let i = 0; i < CLICK_ID_PLATFORM_MAP.length; i++) {
      const entry = CLICK_ID_PLATFORM_MAP[i];
      for (let j = 0; j < entry.params.length; j++) {
        const val = params[entry.params[j]];
        if (val) return val;
      }
    }
    return '';
  }

  /**
   * Classifier used ONLY for platform detection (`detectPlatform`). Returns
   * one of: 'direct', 'internal', 'unknown', or the referrer hostname. The
   * three-label space is what `detectPlatform` switches on — passing the raw
   * URL would defeat the organic-search/social heuristics.
   *
   * The TouchAttribution.referrer field stores the FULL URL (see buildTouch);
   * this helper is intentionally separate.
   */
  function classifyReferrerForPlatform(): string {
    try {
      const ref = win.document.referrer || '';
      if (!ref) return 'direct';

      const refHost = new URL(ref).hostname;
      const currentHost = win.location.hostname;

      if (refHost === currentHost) return 'internal';
      return refHost;
    } catch (e) {
      return 'unknown';
    }
  }

  /** Strip the URL fragment (`#...`) from a href. Defense-in-depth against
   *  credential leakage (OAuth implicit-flow access_tokens, session keys)
   *  ending up persisted in landingPage cookies for years. */
  function stripFragment(href: string): string {
    if (!href) return href;
    const idx = href.indexOf('#');
    return idx === -1 ? href : href.slice(0, idx);
  }

  /** Extract the hostname from a referrer URL. Returns '' for empty input
   *  or unparseable URLs — never throws. */
  function extractReferrerDomain(referrer: string): string {
    if (!referrer) return '';
    try {
      return new URL(referrer).hostname || '';
    } catch (e) {
      return '';
    }
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

  function inferMedium(params: Record<string, string>, platform: string): string {
    if (params.utm_medium) return params.utm_medium;
    // Infer from platform
    if (platform.endsWith('_ads')) return 'cpc';
    if (platform === 'organic_search') return 'organic';
    if (platform === 'organic_social') return 'social';
    if (platform === 'referral') return 'referral';
    if (platform === 'direct') return 'none';
    return '';
  }

  // ---------------------------------------------------------------------------
  // Build curated attribution from raw params
  // ---------------------------------------------------------------------------

  // Custom param aliases — non-standard params that map to standard fields
  const SOURCE_ALIASES = ['source', 'src', 'ref'];
  const MEDIUM_ALIASES = ['medium', 'channel'];
  const CAMPAIGN_ALIASES = ['campaign', 'camp', 'promo'];

  function resolveParam(params: Record<string, string>, primary: string, aliases: string[]): string {
    if (params[primary]) return params[primary];
    for (let i = 0; i < aliases.length; i++) {
      if (params[aliases[i]]) return params[aliases[i]];
    }
    return '';
  }

  function buildTouch(params: Record<string, string>): TouchAttribution {
    // Two referrer views: the classifier feeds platform detection
    // (which keys on 'direct'/'internal' and hostname-substring matches),
    // while the stored TouchAttribution.referrer is the FULL URL for
    // downstream analytics joins (data-team contract).
    const referrerClass = classifyReferrerForPlatform();
    const referrerUrl = (win.document && win.document.referrer) || '';
    const referrerDomain = extractReferrerDomain(referrerUrl);
    const source = resolveParam(params, 'utm_source', SOURCE_ALIASES);
    const medium = resolveParam(params, 'utm_medium', MEDIUM_ALIASES);
    const campaign = resolveParam(params, 'utm_campaign', CAMPAIGN_ALIASES);

    // Detect platform from click IDs, utm_source (not custom aliases), or referrer.
    // Custom aliases like ?source=febpt populate the source field but should NOT
    // override platform detection — platform should come from known signals only.
    const platform = detectPlatform(params, referrerClass);

    return {
      source: source || (platform !== 'direct' ? platform.replace('_ads', '').replace('_', '') : 'direct'),
      medium: medium || inferMedium(params, platform),
      campaign: campaign,
      platform: platform,
      clickId: extractClickId(params),
      // Full URL with query string but WITHOUT the URL fragment.
      // Rationale: OAuth implicit-flow and other auth flows return tokens
      // in `#access_token=…` fragments; persisting those for 2 years in a
      // cookie is a credential-leak vector. The query string is preserved
      // because UTM / marketing params live there. `location.href` includes
      // the fragment by browser default, so we strip it explicitly.
      landingPage: stripFragment((win.location && win.location.href) || '/'),
      referrer: referrerUrl,
      referrerDomain: referrerDomain,
      timestamp: new Date().toISOString(),
    };
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

  function hasNewTrafficParams(params: Record<string, string>): boolean {
    // Check if URL has any marketing-relevant params (UTM, click IDs, custom aliases)
    const marketingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid',
      'msclkid', 'li_fat_id', 'twclid', 'epik', 'sccid',
      ...SOURCE_ALIASES, ...MEDIUM_ALIASES, ...CAMPAIGN_ALIASES];
    for (let i = 0; i < marketingKeys.length; i++) {
      if (params[marketingKeys[i]]) return true;
    }
    return false;
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    const params = extractParams();
    const current = buildTouch(params);
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
      // Restore cached current from existing last touch for consistency
      const existingLast = getLastTouch();
      if (existingLast) cachedCurrent = existingLast;
    }

    // Touch session
    touchSession();

    // Register Mixpanel super property (dataLayer enrichment is now via the enricher HOF)
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
