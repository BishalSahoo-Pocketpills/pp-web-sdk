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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TouchAttribution {
  source: string;
  medium: string;
  campaign: string;
  platform: string;
  clickId: string;
  landingPage: string;
  referrer: string;
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
  storageKeyFirst: string;
  storageKeyLast: string;
  storageKeySession: string;
}

// ---------------------------------------------------------------------------
// Platform detection from click IDs
// ---------------------------------------------------------------------------

var CLICK_ID_PLATFORM_MAP: ReadonlyArray<{ params: string[]; platform: string }> = [
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
var ORGANIC_SEARCH_DOMAINS = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.'];
var ORGANIC_SOCIAL_DOMAINS = ['facebook.', 'instagram.', 'twitter.', 'x.com', 'linkedin.', 'tiktok.', 'pinterest.', 'reddit.'];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAttributionService(
  win: Window & typeof globalThis,
  ppLib: PPLib,
) {
  var config: AttributionServiceConfig = {
    includeFirstTouch: true,
    includeLastTouch: true,
    enrichEvents: true,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
    persistFirstTouch: true,
    storageKeyFirst: 'mktg_first',
    storageKeyLast: 'mktg_last',
    storageKeySession: 'mktg_session',
  };

  var cachedCurrent: TouchAttribution | null = null;
  var initialized = false;

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  function configure(options: Partial<AttributionServiceConfig>): void {
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
    var params: Record<string, string> = {};
    try {
      var searchParams = new URLSearchParams(win.location.search || '');
      searchParams.forEach(function(value, key) {
        var sanitized = ppLib.Security.sanitize(value);
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
    for (var i = 0; i < CLICK_ID_PLATFORM_MAP.length; i++) {
      var entry = CLICK_ID_PLATFORM_MAP[i];
      for (var j = 0; j < entry.params.length; j++) {
        if (params[entry.params[j]]) {
          return entry.platform;
        }
      }
    }

    // Priority 2: utm_source mapping
    var utmSource = params.utm_source;
    if (utmSource) {
      var lower = utmSource.toLowerCase();
      var medium = (params.utm_medium || '').toLowerCase();
      var isPaid = medium === 'cpc' || medium === 'cpm' || medium === 'paid_social' || medium === 'paid' || medium === 'ppc';

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
      var refLower = referrer.toLowerCase();
      for (var s = 0; s < ORGANIC_SEARCH_DOMAINS.length; s++) {
        if (refLower.indexOf(ORGANIC_SEARCH_DOMAINS[s]) !== -1) return 'organic_search';
      }
      for (var o = 0; o < ORGANIC_SOCIAL_DOMAINS.length; o++) {
        if (refLower.indexOf(ORGANIC_SOCIAL_DOMAINS[o]) !== -1) return 'organic_social';
      }
      return 'referral';
    }

    return 'direct';
  }

  function extractClickId(params: Record<string, string>): string {
    for (var i = 0; i < CLICK_ID_PLATFORM_MAP.length; i++) {
      var entry = CLICK_ID_PLATFORM_MAP[i];
      for (var j = 0; j < entry.params.length; j++) {
        var val = params[entry.params[j]];
        if (val) return val;
      }
    }
    return '';
  }

  function classifyReferrer(): string {
    try {
      var ref = win.document.referrer || '';
      if (!ref) return 'direct';

      var refHost = new URL(ref).hostname;
      var currentHost = win.location.hostname;

      if (refHost === currentHost) return 'internal';
      return refHost;
    } catch (e) {
      return 'unknown';
    }
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
  var SOURCE_ALIASES = ['source', 'src', 'ref'];
  var MEDIUM_ALIASES = ['medium', 'channel'];
  var CAMPAIGN_ALIASES = ['campaign', 'camp', 'promo'];

  function resolveParam(params: Record<string, string>, primary: string, aliases: string[]): string {
    if (params[primary]) return params[primary];
    for (var i = 0; i < aliases.length; i++) {
      if (params[aliases[i]]) return params[aliases[i]];
    }
    return '';
  }

  function buildTouch(params: Record<string, string>): TouchAttribution {
    var referrer = classifyReferrer();
    var source = resolveParam(params, 'utm_source', SOURCE_ALIASES);
    var medium = resolveParam(params, 'utm_medium', MEDIUM_ALIASES);
    var campaign = resolveParam(params, 'utm_campaign', CAMPAIGN_ALIASES);

    // Detect platform from click IDs, utm_source (not custom aliases), or referrer.
    // Custom aliases like ?source=febpt populate the source field but should NOT
    // override platform detection — platform should come from known signals only.
    var platform = detectPlatform(params, referrer);

    return {
      source: source || (platform !== 'direct' ? platform.replace('_ads', '').replace('_', '') : 'direct'),
      medium: medium || inferMedium(params, platform),
      campaign: campaign,
      platform: platform,
      clickId: extractClickId(params),
      landingPage: win.location.pathname || '/',
      referrer: referrer,
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  function isSessionActive(): boolean {
    var sessionStart = ppLib.Storage.get(config.storageKeySession);
    if (!sessionStart) return false;
    var elapsed = Date.now() - parseInt(sessionStart, 10);
    return elapsed < config.sessionTimeoutMs;
  }

  function touchSession(): void {
    ppLib.Storage.set(config.storageKeySession, String(Date.now()));
  }

  // ---------------------------------------------------------------------------
  // Storage (first/last touch)
  // ---------------------------------------------------------------------------

  function storeFirstTouch(touch: TouchAttribution): void {
    var existing = ppLib.Storage.get(config.storageKeyFirst, config.persistFirstTouch);
    if (!existing) {
      ppLib.Storage.set(config.storageKeyFirst, touch, config.persistFirstTouch);
      ppLib.log('info', '[ppAttribution] First touch stored: ' + touch.platform + ' / ' + touch.source);
    }
  }

  function storeLastTouch(touch: TouchAttribution): void {
    ppLib.Storage.set(config.storageKeyLast, touch);
    ppLib.log('info', '[ppAttribution] Last touch stored: ' + touch.platform + ' / ' + touch.source);
  }

  function getFirstTouch(): TouchAttribution | null {
    return ppLib.Storage.get(config.storageKeyFirst, config.persistFirstTouch) || null;
  }

  function getLastTouch(): TouchAttribution | null {
    return ppLib.Storage.get(config.storageKeyLast) || null;
  }

  // ---------------------------------------------------------------------------
  // Initialize — extract params, store touches
  // ---------------------------------------------------------------------------

  function hasNewTrafficParams(params: Record<string, string>): boolean {
    // Check if URL has any marketing-relevant params (UTM, click IDs, custom aliases)
    var marketingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid',
      'msclkid', 'li_fat_id', 'twclid', 'epik', 'sccid',
      ...SOURCE_ALIASES, ...MEDIUM_ALIASES, ...CAMPAIGN_ALIASES];
    for (var i = 0; i < marketingKeys.length; i++) {
      if (params[marketingKeys[i]]) return true;
    }
    return false;
  }

  function init(): void {
    if (initialized) return;
    initialized = true;

    var params = extractParams();
    var current = buildTouch(params);
    var hasNewParams = hasNewTrafficParams(params);
    var sessionActive = isSessionActive();

    // Always update current session cache
    cachedCurrent = current;

    // Store first touch (only if not already stored)
    storeFirstTouch(current);

    // Update last touch only if:
    // 1. New marketing params detected (user arrived from a new campaign), OR
    // 2. Session has expired (new session = new touch)
    if (hasNewParams || !sessionActive) {
      storeLastTouch(current);
    } else {
      // Restore cached current from existing last touch for consistency
      var existingLast = getLastTouch();
      if (existingLast) cachedCurrent = existingLast;
    }

    // Touch session
    touchSession();

    ppLib.log('info', '[ppAttribution] Initialized — platform: ' + current.platform + ', source: ' + current.source +
      (hasNewParams ? ' (new params)' : sessionActive ? ' (existing session)' : ' (new session)'));
  }

  // ---------------------------------------------------------------------------
  // Public API: get the marketingAttribution object
  // ---------------------------------------------------------------------------

  function getMarketingAttribution(): MarketingAttribution | null {
    if (!config.enrichEvents) return null;

    var current = cachedCurrent || getLastTouch();
    if (!current) return null;

    var attribution: MarketingAttribution = {
      source: current.source,
      medium: current.medium,
      campaign: current.campaign,
      platform: current.platform,
      clickId: current.clickId,
      landingPage: current.landingPage,
      referrer: current.referrer,
      timestamp: current.timestamp,
    };

    if (config.includeFirstTouch) {
      var first = getFirstTouch();
      if (first) attribution.firstTouch = first;
    }

    if (config.includeLastTouch) {
      var last = getLastTouch();
      if (last) attribution.lastTouch = last;
    }

    return attribution;
  }

  // ---------------------------------------------------------------------------
  // Event enrichment helper — merges marketingAttribution into an event object
  // ---------------------------------------------------------------------------

  function enrichEvent<T extends Record<string, unknown>>(event: T): T & { marketingAttribution?: MarketingAttribution } {
    if (!config.enrichEvents) return event;

    var attribution = getMarketingAttribution();
    if (!attribution) return event;

    // Attach attribution as a new property — safe because callers pass
    // locally-constructed objects (DataLayer enriched, EventSource data).
    // The attribution object is freshly built each call, so no aliasing risk.
    (event as Record<string, unknown>).marketingAttribution = attribution;
    return event as T & { marketingAttribution?: MarketingAttribution };
  }

  // ---------------------------------------------------------------------------
  // Clear stored data (consent revocation)
  // ---------------------------------------------------------------------------

  function clear(): void {
    ppLib.Storage.remove(config.storageKeyFirst);
    ppLib.Storage.remove(config.storageKeyFirst, true); // persistent
    ppLib.Storage.remove(config.storageKeyLast);
    ppLib.Storage.remove(config.storageKeySession);
    cachedCurrent = null;
    initialized = false;
    ppLib.log('info', '[ppAttribution] Attribution data cleared');
  }

  return {
    configure: configure,
    init: init,
    get: getMarketingAttribution,
    enrich: enrichEvent,
    getFirstTouch: getFirstTouch,
    getLastTouch: getLastTouch,
    getCurrent: function(): TouchAttribution | null { return cachedCurrent; },
    clear: clear,
  };
}

export type AttributionService = ReturnType<typeof createAttributionService>;
