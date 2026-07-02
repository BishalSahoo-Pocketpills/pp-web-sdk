/**
 * Event Properties Builder
 *
 * Shared property builder used by:
 *  - the dataLayer enricher (`src/datalayer/enrichers/event-properties.ts`)
 *  - the mixpanel.track wrapper (`src/mixpanel/index.ts`)
 *
 * Produces the canonical per-event property shape so every event sent to
 * GTM and Mixpanel carries the same context (UTM touch attribution,
 * device/session/login state, page, click IDs, marketing attribution).
 *
 * Stable per-session fields (browser, device_type, country) are memoized;
 * volatile fields (URL, referrer, login state, attribution, device_id) are
 * recomputed on each build() call. `device_id` is read live from Mixpanel
 * (`$device_id`) so it picks up the new value after `mp.reset()` without a
 * page reload.
 */
import type { PPLib } from '@src/types/common.types';
import type { DeepPartial } from '@src/types/utility.types';
import { deriveIsAuthenticated, deriveLoggedIn, isValidUserId, toLoggedInString } from '@src/common/auth';
import {
  UTM_FIRST_TOUCH,
  UTM_LAST_TOUCH,
  MARKETING_ATTRIBUTION_KEY,
} from '@src/common/super-property-keys';
import { createLocalStorageValue } from '@src/common/persistent-storage';
import { utmFallback } from '@src/common/utm-fallback';
import {
  type RawUtmTouch,
  type ExtendedUtmTouch,
  type NormalizedTouch,
  UTM_KEYS,
  emptyUtm,
  emptyExtended,
  parseUtmTouch,
} from '@src/common/utm-types';
import {
  SEARCH_ENGINE_PATTERNS,
  getSearchEngineName,
  MULTI_PART_TLDS,
  getRootDomain,
  CLICK_ID_PLATFORM_MAP,
  ORGANIC_SEARCH_DOMAINS,
  ORGANIC_SOCIAL_DOMAINS,
  SOURCE_ALIASES,
  MEDIUM_ALIASES,
  CAMPAIGN_ALIASES,
  extractParams,
  detectPlatform,
  extractClickId,
  classifyReferrerForPlatform,
  stripFragment,
  PII_QUERY_PARAM_DENYLIST,
  sanitizeLandingPage,
  extractReferrerDomain,
  inferMedium,
  resolveParam,
  hasNewTrafficParams,
  buildNormalizedTouch,
} from '@src/common/attribution';

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility — other modules import these symbols
// from '@src/common/event-properties-builder' and must continue to do so.
// ---------------------------------------------------------------------------
export type { RawUtmTouch, ExtendedUtmTouch, NormalizedTouch };
export { UTM_KEYS, emptyUtm, emptyExtended, parseUtmTouch };
export {
  SEARCH_ENGINE_PATTERNS,
  getSearchEngineName,
  MULTI_PART_TLDS,
  getRootDomain,
  CLICK_ID_PLATFORM_MAP,
  ORGANIC_SEARCH_DOMAINS,
  ORGANIC_SOCIAL_DOMAINS,
  SOURCE_ALIASES,
  MEDIUM_ALIASES,
  CAMPAIGN_ALIASES,
  extractParams,
  detectPlatform,
  extractClickId,
  classifyReferrerForPlatform,
  stripFragment,
  PII_QUERY_PARAM_DENYLIST,
  sanitizeLandingPage,
  extractReferrerDomain,
  inferMedium,
  resolveParam,
  hasNewTrafficParams,
  buildNormalizedTouch,
};

export interface EventPropertiesBuilderCookieNames {
  userId: string;
  patientId: string;
  appAuth: string;
  country: string;
}

export interface EventPropertiesBuilderOpts {
  cookieNames?: DeepPartial<EventPropertiesBuilderCookieNames>;
  defaultPlatform?: string;
}

export interface BuiltUserProperties {
  userId: string;
  patientId: string;
  pp_distinct_id: string;
}

export interface BuiltEventProperties {
  current_url: string;
  url: string;
  device_id: string;
  pp_user_id: number | null;
  pp_patient_id: number | null;
  pp_session_id: string;
  pp_timestamp: number;
  platform: string;
  // Stringified boolean ("true"/"false") per the event-attribute contract —
  // consumers (Mixpanel, GTM, BigQuery) treat the value as a categorical
  // string, not a boolean. The internal closure variable stays boolean.
  logged_in: string;
  app_is_authenticated: boolean;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  Country: string;
  browser: string;
  device_type: string;
  /**
   * Device MODEL — `iPhone` / `iPad` / `iPod` / `Android` / `MacBook` /
   * `Windows` / `Linux` / `''`. Parsed from user-agent. Distinct from
   * `device_type` (mobile / tablet / desktop). Per the data-team contract,
   * analysts use `Device` for the model breakdown and `device_type` for
   * the form-factor breakdown — both are needed. Capitalized to match
   * `Country` (same convention: human-readable proper-noun dimensions).
   */
  Device: string;
  referrer: string;
  initial_referrer: string;
  marketingAttribution: NormalizedTouch | null;
  // 1C touch attributes — captured by the attribution service. Full URL,
  // its hostname, and the full landing URL, for both first and last touch.
  'referrer [first touch]': string;
  'referrer [last touch]': string;
  'referrer_domain [first touch]': string;
  'referrer_domain [last touch]': string;
  'landing_page_url [first touch]': string;
  'landing_page_url [last touch]': string;
  // SDK-owned backup of Mixpanel's native $initial_referrer /
  // $initial_referring_domain. Same first-touch value as the bracket fields
  // above, named to parallel the Mixpanel columns so consumers have a reliable,
  // explicitly-owned referrer when the native value reads $direct (see below).
  pp_initial_referrer: string;
  pp_initial_referring_domain: string;
  [bracketKey: string]: unknown;
}

export interface BuiltPage {
  url: string;
  title: string;
  referrer: string;
}

export interface BuiltAttribution {
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ttclid: string | null;
  epik: string | null;
  rdt_cid: string | null;
}

export interface BuiltEventBundle {
  userProperties: BuiltUserProperties;
  eventProperties: BuiltEventProperties;
  page: BuiltPage;
  attribution: BuiltAttribution;
}

export interface EventPropertiesBuilder {
  configure: (next: EventPropertiesBuilderOpts) => void;
  build: () => BuiltEventBundle;
  buildFlat: () => Record<string, unknown>;
  /**
   * Returns the bundle's four wrapper blocks as own-keys at the top level of
   * a fresh object — the same shape the dataLayer enricher emits. Used by
   * the Mixpanel facade when `emitMode === 'nested'` (and the wrapper half
   * of `emitMode === 'dual'`) to align Mixpanel's payload with the
   * dataLayer contract.
   */
  buildNested: () => Record<string, unknown>;
  /** Literal utm_* params from the current visit's URL (no normalization). */
  getCurrentUtm: () => RawUtmTouch;
  /** Persisted first-touch utm_* — only set on the first visit that had utm_* params. */
  getFirstTouchUtm: () => RawUtmTouch;
  /** Persisted last-touch utm_* — overwritten on every visit that has utm_* params. */
  getLastTouchUtm: () => RawUtmTouch;
  /**
   * Resolved marketing attribution (normalized source/medium/campaign/
   * platform/clickId + visit metadata) for the current touch. Replaces
   * `ppLib.attribution.get()`. Returns null before any capture has run.
   */
  getMarketingAttribution: () => NormalizedTouch | null;
}

// Per Analytics events spec (3E): strip null / undefined / '' values from
// property bags before they leave the SDK. Mixpanel ingestion treats
// empty strings as legitimate values, polluting funnels with "(empty)"
// segments; null/undefined breaks BigQuery exports. Stripping at the
// builder boundary is cheaper than stripping at every dispatcher.
// Pure: returns a fresh object; does NOT mutate the input.
//
// ALLOW_NULL: identity fields that intentionally emit `null` for anonymous /
// logged-out visitors (replacing the legacy '-1' sentinel). They are exempt
// from the null/undefined drop so the explicit null survives to Mixpanel
// (which keeps custom-property nulls) and GA4, staying queryable for
// anonymous segments. The empty-string drop still applies to every key.
const ALLOW_NULL: ReadonlySet<string> = new Set(['pp_user_id', 'pp_patient_id']);

export function stripEmptyProps(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = input[k];
    if ((v === null || v === undefined) && !ALLOW_NULL.has(k)) continue;
    if (typeof v === 'string' && v === '') continue;
    out[k] = v;
  }
  return out;
}

// Per the data team's reference event shape, Mixpanel's own auto-collected
// `$`-prefixed properties are the canonical source for these dimensions
// (displayed in the Mixpanel UI as "Browser", "Current URL", "Device",
// "Initial Referrer", etc.). The SDK still emits the snake_case
// equivalents for dataLayer / GTM consumers — but they are stripped from
// the Mixpanel-bound payload to avoid two columns per dimension in
// Mixpanel event-property panels. `buildFlat()` (Mixpanel) strips them;
// `build()` (dataLayer) keeps them.
export const MIXPANEL_DUPLICATE_KEYS: ReadonlySet<string> = new Set([
  // browser — Mixpanel auto: $browser ("Browser") provides the same value.
  'browser',
  // device_id — Mixpanel auto: $device_id ("Device ID") is Mixpanel's
  // anonymous tracking UUID. We read OUR `device_id` directly from
  // Mixpanel's `$device_id` at event-build time, so the values are now
  // identical — stripping the snake_case copy avoids two columns showing
  // the same value. The same value still rides as `pp_distinct_id` for
  // anonymous visitors (surfaces as "Distinct ID Before Identity").
  'device_id',
  // current_url — Mixpanel auto: $current_url ("Current URL") shows the
  // full URL. Ours is path-only, but visually duplicates the column.
  // The path-only view is still available under page_path.
  'current_url',
  // referrer — Mixpanel auto: $referrer / $referring_domain ("Initial
  // Referrer" / "Initial Referring Domain") cover the per-event referrer.
  'referrer',
  'initial_referrer',
  // utm_source / utm_medium / utm_campaign / utm_content / utm_term —
  // Mixpanel's built-in track_marketing auto-captures these from the URL.
  // When UTMs are absent Mixpanel leaves them unset (no $direct default),
  // which is the correct behavior. Stripping our copies lets Mixpanel own
  // these columns natively; the bracketed [first touch] / [last touch]
  // variants remain and carry $direct defaults for direct-traffic queries.
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  // NOTE intentionally NOT stripped:
  //   - `Device`: Mixpanel's $device only fills on mobile (device model
  //     like "iPhone"/"Android"); on desktop it's empty. Our `Device`
  //     fills both ("MacBook" / "Android") so it covers the gap.
  //   - `device_type`: no Mixpanel equivalent — "desktop"/"mobile"/
  //     "tablet" is unique to our SDK.
]);

const UTM_FIRST_TOUCH_KEY = 'pp_utm_first_touch';
const UTM_LAST_TOUCH_KEY = 'pp_utm_last_touch';

// NOTE: first/last-touch are persisted in localStorage (no TTL) — see
// createLocalStorageValue below. There is intentionally NO max-age constant
// for them: first-touch is locked on first capture and last-touch rotates on
// signal (it does not expire on a clock). The former UTM_FIRST/LAST_TOUCH_
// MAX_AGE_SECONDS cookie-TTL constants were removed when the stores moved to
// localStorage; only the session window below remains time-bounded.
//
// Session window — 30 minutes. Gates rotation of the pp_utm_*_touch
// normalized slice (see captureUtmTouches): last-touch only refreshes when
// (a) new traffic params on the URL, or (b) the session has expired AND
// the referrer isn't self-referral. Stored inline on
// pp_utm_last_touch.sessionTs (v3.2.0's standalone pp_utm_session cookie
// was retired in v3.3.0).
const UTM_SESSION_MAX_AGE_SECONDS = 1800;

// Legacy pp_mktg_* cookies — read-and-fold migration source for visitors
// who arrived before the consolidation. The mktg migration shim folds
// their normalized + visit-metadata data into the corresponding
// pp_utm_*_touch cookies (only when those normalized slices are still
// empty), then deletes the legacy cookies so they don't linger.
const LEGACY_MKTG_FIRST_KEY = 'pp_mktg_first_touch';
const LEGACY_MKTG_LAST_KEY = 'pp_mktg_last_touch';

// Persistent self-disable marker (F22) for the one-time pp_mktg_* migration.
// Once the fold + cleanup has run on a device, this localStorage flag lets
// every future page load skip the whole shim — the legacy cookies are gone, so
// re-running only burns cookie reads/writes on each navigation.
const MKTG_MIGRATION_DONE_KEY = 'pp_mktg_migrated';

/**
 * Parse a legacy `pp_mktg_*_touch` cookie. The pre-consolidation
 * attribution service serialised these as JSON with the 9 normalized +
 * visit-metadata fields (no utm_* literal slice — that lived in the
 * separate pp_utm_*_touch cookies). Used by the mktg migration shim to
 * fold legacy data into the consolidated extended cookie. Returns null
 * when the input isn't an object with all 9 string fields — strict so
 * partial / pre-1C entries fall through and the migration treats the
 * visitor as new.
 */
function parseLegacyMktgTouch(raw: string): NormalizedTouch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const required: ReadonlyArray<keyof NormalizedTouch> = [
      'source', 'medium', 'campaign', 'platform', 'clickId',
      'landingPage', 'referrer', 'referrerDomain', 'timestamp',
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


function defaultCookieNames(): EventPropertiesBuilderCookieNames {
  return {
    userId: 'userId',
    patientId: 'patientId',
    appAuth: 'app_is_authenticated',
    country: 'country'
  };
}

export function createEventPropertiesBuilder(
  win: Window & typeof globalThis,
  ppLib: PPLib
): EventPropertiesBuilder {

  let cookieNames: EventPropertiesBuilderCookieNames = defaultCookieNames();
  let defaultPlatform: string = 'web';

  // Stable per-session fields — derived once, reset on configure().
  // device_id is intentionally NOT cached here: it's read live from
  // Mixpanel each build() so post-reset rotations are picked up without
  // a page reload.
  let stableCache: { browser: string; device_type: string; device: string; country: string } | null = null;

  function configure(next: EventPropertiesBuilderOpts): void {
    if (next.cookieNames) {
      const prev = cookieNames;
      cookieNames = {
        userId: next.cookieNames.userId || prev.userId,
        patientId: next.cookieNames.patientId || prev.patientId,
        appAuth: next.cookieNames.appAuth || prev.appAuth,
        country: next.cookieNames.country || prev.country
      };
    }
    if (typeof next.defaultPlatform === 'string') {
      defaultPlatform = next.defaultPlatform;
    }
    stableCache = null; // invalidate — country cookie name may have changed
  }

  // Mixpanel's `$device_id` is the single source of truth for the anonymous
  // device identifier. Mixpanel persists it in its own cross-subdomain
  // cookie/localStorage; we read it live at event-build time. No SDK-side
  // cookie mirror — non-Mixpanel destinations (dataLayer, Braze) read the
  // same value Mixpanel uses by calling here.
  //
  // The mixpanelReady gate in common/index.ts holds non-Mixpanel auto-events
  // until `$device_id` is readable (3s timeout fallback for deployments where
  // Mixpanel never loads — those visitors get an empty device_id, which is
  // industry-standard for blocked-SDK situations).
  function getOrCreateDeviceId(): string {
    try {
      const mp = win.mixpanel;
      if (!mp || typeof mp.get_property !== 'function') return '';
      const id = mp.get_property('$device_id');
      return typeof id === 'string' ? id : '';
    } catch (e) {
      return '';
    }
  }

  function parseBrowser(ua: string): string {
    if (!ua) return '';
    if (ua.indexOf('Edg/') !== -1) return 'Edge';
    if (ua.indexOf('OPR/') !== -1 || ua.indexOf('Opera') !== -1) return 'Opera';
    if (ua.indexOf('Chrome/') !== -1) return 'Chrome';
    if (ua.indexOf('Safari/') !== -1 && ua.indexOf('Chrome') === -1) return 'Safari';
    if (ua.indexOf('Firefox/') !== -1) return 'Firefox';
    if (ua.indexOf('MSIE') !== -1 || ua.indexOf('Trident/') !== -1) return 'IE';
    return '';
  }

  function parseDeviceType(ua: string): string {
    if (!ua) return '';
    const lower = ua.toLowerCase();
    if (lower.indexOf('ipad') !== -1) return 'tablet';
    if (lower.indexOf('tablet') !== -1 || lower.indexOf('kindle') !== -1) return 'tablet';
    // 'mobi' catches both 'Mobile' and 'Mobi' (Android Chrome, iPhone, etc.)
    if (lower.indexOf('mobi') !== -1) return 'mobile';
    if (lower.indexOf('android') !== -1) return 'tablet'; // Android without 'mobile' = tablet
    return 'desktop';
  }

  // Device MODEL parser. Distinct from parseDeviceType (which returns
  // form-factor: mobile/tablet/desktop). Order matters — iPad and iPod
  // both contain the substring "iP", and the iPhone check must NOT match
  // them. Macintosh UAs map to MacBook (UA can't reliably distinguish
  // iMac / Mac mini / MacBook so we pick the most common). The data-team
  // contract requires this exact set: iPhone, iPad, iPod, Android,
  // MacBook, Windows, Linux, ''.
  function parseDevice(ua: string): string {
    if (!ua) return '';
    if (ua.indexOf('iPhone') !== -1) return 'iPhone';
    if (ua.indexOf('iPad') !== -1) return 'iPad';
    if (ua.indexOf('iPod') !== -1) return 'iPod';
    if (ua.indexOf('Android') !== -1) return 'Android';
    if (ua.indexOf('Macintosh') !== -1) return 'MacBook';
    if (ua.indexOf('Windows') !== -1) return 'Windows';
    if (ua.indexOf('Linux') !== -1) return 'Linux';
    return '';
  }

  function extractDomain(url: string): string {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  // The SDK emits `Country` (capitalized — proper-noun dimension convention,
  // same as `Device`) as an ISO-2 code (e.g. "CA") for cross-tool joins
  // (Mixpanel, Braze, GA, BigQuery exports). This is INTENTIONALLY distinct
  // from the geo-derived properties Mixpanel auto-attaches to every event
  // from server-side IP lookup — those appear in the raw payload as
  // `mp_country_code` ("CA") and are shown in Mixpanel's UI with the
  // full-name label "Country: Canada". The two coexist by design; analysts
  // querying our SDK should use the capitalized `Country` property.
  //
  // Source: cookie only. We deliberately do NOT fall back to
  // navigator.language — it reflects the browser's UI language (often
  // "en-US" by default on Chrome regardless of physical location) and
  // produces confidently-wrong values. When the cookie is empty we leave
  // `Country` empty rather than ship fake data; analysts can rely on
  // Mixpanel's IP-based `mp_country_code` for those events. The cookie
  // should be set server-side from real IP geolocation (e.g. via the
  // CF-IPCountry header at the edge).

  // ---------------------------------------------------------------------------
  // Raw UTM tracking — `utm_*` keys are LITERAL URL params, intentionally
  // separate from the attribution service's normalized source/medium/campaign
  // (which fold in aliases like `source=`, `gclid=`, etc. into
  // marketingAttribution). Conflating the two muddies analytics: a visit with
  // `?source=febpt` should leave `utm_source` empty (`$direct`) while
  // `marketingAttribution.source` correctly reports "febpt".
  // ---------------------------------------------------------------------------

  // URL-keyed memoization for parsed search params. Every build() call hits
  // this; without a cache, mp.track() pays for `new URLSearchParams(...)`
  // plus 5× getQueryParam tokenization per event. URL is stable within a
  // request unless the user navigates client-side, so we key on the raw
  // URL string.
  let cachedUrl: string | null = null;
  let cachedSearchParams: URLSearchParams | null = null;
  let cachedUtm: RawUtmTouch | null = null;

  function getSearchParams(url: string): URLSearchParams {
    if (cachedUrl !== url || cachedSearchParams === null) {
      cachedUrl = url;
      cachedSearchParams = new URLSearchParams(extractSearchString(url));
      cachedUtm = null; // search changed → UTM cache invalidated
    }
    return cachedSearchParams;
  }

  function extractSearchString(url: string): string {
    const qIdx = url.indexOf('?');
    if (qIdx === -1) return '';
    // Strip the leading '?' and any hash fragment that follows.
    const afterQ = url.slice(qIdx + 1);
    const hashIdx = afterQ.indexOf('#');
    return hashIdx === -1 ? afterQ : afterQ.slice(0, hashIdx);
  }

  function readUtmFromUrl(): RawUtmTouch {
    try {
      // Prefer document.URL — matches the rest of the SDK's URL access and
      // honors the test pattern of stubbing document.URL via defineProperty.
      const url = (win.document && win.document.URL) || win.location.href || '';
      if (cachedUtm !== null && cachedUrl === url) {
        return cachedUtm;
      }
      const params = getSearchParams(url);
      const result = emptyUtm();
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const k = UTM_KEYS[i];
        result[k] = params.get(k) || '';
      }
      cachedUtm = result;
      return result;
    } catch (e) {
      /* keep empty result on any failure */
      return emptyUtm();
    }
  }

  // UTM touch storage — localStorage-primary. Attribution data is only read
  // by client-side JS (the SDK), never by the server. Storing it in cookies
  // added ~1 KB of URL-encoded JSON to every HTTP request header, which
  // combined with Mixpanel + Angular auth cookies exceeded nginx's
  // large_client_header_buffers and caused 400 errors.
  //
  // On first read, any existing cookie value is migrated into localStorage
  // and the cookie is deleted to free header budget. Cross-subdomain access
  // (try ↔ www) is not needed — the SDK only runs on Webflow pages.
  const utmFirstTouchStore = createLocalStorageValue<ExtendedUtmTouch>(win, ppLib, {
    key: UTM_FIRST_TOUCH_KEY,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseUtmTouch,
    legacyCookieName: UTM_FIRST_TOUCH_KEY,
  });

  const utmLastTouchStore = createLocalStorageValue<ExtendedUtmTouch>(win, ppLib, {
    key: UTM_LAST_TOUCH_KEY,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseUtmTouch,
    legacyCookieName: UTM_LAST_TOUCH_KEY,
  });

  function storeForKey(storageKey: string) {
    return storageKey === UTM_FIRST_TOUCH_KEY ? utmFirstTouchStore : utmLastTouchStore;
  }

  function readStoredExtended(storageKey: string): ExtendedUtmTouch {
    try {
      return storeForKey(storageKey).read() || emptyExtended();
    } catch (e) {
      return emptyExtended();
    }
  }

  // Projection helper — strips the extended slices down to the literal-only
  // shape returned by the public getFirstTouchUtm / getLastTouchUtm getters
  // and used by build()'s utm_* [first/last touch] keys.
  function projectToRaw(touch: ExtendedUtmTouch): RawUtmTouch {
    return {
      utm_source: touch.utm_source,
      utm_medium: touch.utm_medium,
      utm_campaign: touch.utm_campaign,
      utm_content: touch.utm_content,
      utm_term: touch.utm_term,
    };
  }

  function readStoredUtm(storageKey: string): RawUtmTouch {
    return projectToRaw(readStoredExtended(storageKey));
  }

  function persistExtended(storageKey: string, value: ExtendedUtmTouch): void {
    try {
      storeForKey(storageKey).write(value);
    } catch (e) {
      /* persistence is best-effort */
    }
  }

  // ---------------------------------------------------------------------------
  // 5-step UTM resolver (Analytics UTM events spec).
  //
  // First-ever capture (no prior last-touch persisted):
  //   1. URL param present → use it.
  //   2. Else search-engine referrer → utm_source = engine name,
  //                                    utm_medium = 'organic',
  //                                    utm_campaign = '$direct',
  //                                    utm_content/term = 'none'.
  //   3. Else external (non-self) referrer → utm_source = root domain,
  //                                          utm_medium = 'referral',
  //                                          utm_campaign = '$direct',
  //                                          utm_content/term = 'none'.
  //   4. Else no referrer → utm_source/medium/campaign = '$direct',
  //                         utm_content/term = 'none'.
  //
  // Note on defaults: utm_content and utm_term default to 'none' (not
  // '$direct') so analytics consumers can distinguish "direct traffic with
  // no creative/keyword context" from "creative/keyword genuinely absent".
  // utm_source/medium/campaign continue to default to '$direct' for
  // historical continuity in the Mixpanel funnels keyed off those values.
  //
  // Subsequent captures:
  //   1. URL param present for a key → overwrite that key.
  //   2. Else → carry forward (no update).
  //
  // Critically, rules 2/3/4 do NOT fire on session rotation — session expiry
  // only rotates session_id; the persisted UTM is retained. The "first-ever
  // capture" signal is the absence of any last-touch entry in the cookie.
  // ---------------------------------------------------------------------------

  function isSelfReferralRef(refHost: string): boolean {
    if (!refHost) return false;
    const currentHost = (win.location && win.location.hostname) || '';
    if (refHost === currentHost) return true;
    const cookieDomain = ppLib.config && ppLib.config.cookieDomain;
    if (typeof cookieDomain === 'string' && cookieDomain.length > 0) {
      const root = cookieDomain.charAt(0) === '.' ? cookieDomain.slice(1) : cookieDomain;
      if (root && (refHost === root || refHost.endsWith('.' + root))) return true;
    }
    return false;
  }

  function classifyReferrerForResolver(): { kind: 'search' | 'external' | 'direct'; engine: string | null; rootDomain: string } {
    const refRaw = (win.document && win.document.referrer) || '';
    if (!refRaw) return { kind: 'direct', engine: null, rootDomain: '' };
    let refHost = '';
    try { refHost = new URL(refRaw).hostname; } catch (e) { /* unparseable → treat as direct */ }
    if (!refHost) return { kind: 'direct', engine: null, rootDomain: '' };
    if (isSelfReferralRef(refHost)) return { kind: 'direct', engine: null, rootDomain: '' };

    const engine = getSearchEngineName(refHost);
    if (engine) return { kind: 'search', engine: engine, rootDomain: '' };
    return { kind: 'external', engine: null, rootDomain: getRootDomain(refHost) };
  }

  /**
   * Resolve the UTM bag for a first-ever capture. URL params always win;
   * the referrer-based fallbacks (rules 2/3/4) only fill the gaps.
   */
  function resolveFirstCapture(urlUtm: RawUtmTouch): RawUtmTouch {
    const cls = classifyReferrerForResolver();

    let sourceFallback: string;
    let mediumFallback: string;
    if (cls.kind === 'search') {
      sourceFallback = cls.engine || '$direct';
      mediumFallback = 'organic';
    } else if (cls.kind === 'external') {
      sourceFallback = cls.rootDomain || '$direct';
      mediumFallback = 'referral';
    } else {
      sourceFallback = '$direct';
      mediumFallback = '$direct';
    }

    return {
      utm_source: urlUtm.utm_source || sourceFallback,
      utm_medium: urlUtm.utm_medium || mediumFallback,
      utm_campaign: urlUtm.utm_campaign || '$direct',
      utm_content: urlUtm.utm_content || 'none',
      utm_term: urlUtm.utm_term || 'none',
    };
  }

  function isFirstEverCapture(stored: RawUtmTouch): boolean {
    for (let i = 0; i < UTM_KEYS.length; i++) {
      if (stored[UTM_KEYS[i]] !== '') return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Session activity check. Reads the inline `sessionTs` field on
  // pp_utm_last_touch — the standalone pp_utm_session cookie was retired in
  // v3.3.0 to consolidate cookie sprawl. Returns false when sessionTs is 0
  // (never written, or pre-v3.3.0 cookie with no field) or older than 30 min.
  // ---------------------------------------------------------------------------
  function isUtmSessionActiveFromExt(ext: ExtendedUtmTouch): boolean {
    if (!ext.sessionTs) return false;
    return (Date.now() - ext.sessionTs) < UTM_SESSION_MAX_AGE_SECONDS * 1000;
  }

  /**
   * Self-referral check on a raw referrer URL. Wraps the hostname-based
   * `isSelfReferralRef` after a `new URL(...)` parse. Conservative: empty /
   * unparseable input is treated as NOT self-referral (so the caller's
   * normal rotation logic runs).
   */
  function isSelfReferralFromUrl(referrerUrl: string): boolean {
    if (!referrerUrl) return false;
    let refHost = '';
    try { refHost = new URL(referrerUrl).hostname; } catch (e) { return false; }
    return isSelfReferralRef(refHost);
  }

  // ---------------------------------------------------------------------------
  // Legacy pp_mktg_* migration shim.
  //
  // Pre-consolidation, normalized attribution lived in pp_mktg_first_touch /
  // pp_mktg_last_touch (managed by the legacy attribution service). The shim
  // folds those cookies' data into the pp_utm_*_touch cookies' normalized
  // slice on first builder use, then DELETES the legacy cookies + the
  // pp_mktg_session marker so they don't linger on visitors' browsers for
  // up to 2 years.
  //
  // Runs at most once per builder instance. Only folds when the pp_utm_*
  // normalized slice is still empty (canary: `platform`, always non-empty
  // after a real write), so a visitor mid-migration with both cookies
  // populated keeps the fresher pp_utm_* data.
  // ---------------------------------------------------------------------------
  let mktgMigrated = false;
  function migrateLegacyMktgCookiesOnce(): void {
    if (mktgMigrated) return;
    mktgMigrated = true;

    // Persistent self-disable (F22): the in-memory guard above only covers a
    // single page load. Once the fold + cleanup has completed on this device,
    // a localStorage marker short-circuits the shim on every FUTURE load. It is
    // purely an optimization — if localStorage is blocked the shim still runs
    // each load and stays correct (the fold is idempotent; the deletes no-op
    // once the cookies are gone). The marker is written below via the same
    // localStorage the fold uses, so an *availability* failure fails both
    // together (no marker without a fold). The marker never WORSENS data loss:
    // the legacy cookies are deleted via the cookie API in the same run
    // regardless, so a later marker-skip has nothing left to migrate anyway.
    try {
      if (win.localStorage.getItem(MKTG_MIGRATION_DONE_KEY)) return;
    } catch (e) { /* localStorage blocked — fall through and run the shim */ }

    const foldInto = (storageKey: string, legacyCookieName: string): void => {
      const ext = readStoredExtended(storageKey);
      if (ext.platform) return; // already populated — skip
      let raw: string | null;
      try { raw = ppLib.getCookie(legacyCookieName); } catch (e) { return; }
      if (!raw) return;
      const mktg = parseLegacyMktgTouch(raw);
      if (!mktg) return;
      // Merge legacy normalized data into the extended cookie; keep the
      // utm_* literal slice from whatever the extended cookie already had
      // (so a parallel 5-step capture isn't overwritten). sessionTs is
      // carried forward — the v3.2.0 → v3.3.0 session handoff (a few lines
      // below) may have populated it from pp_utm_session before this fold.
      persistExtended(storageKey, {
        utm_source: ext.utm_source,
        utm_medium: ext.utm_medium,
        utm_campaign: ext.utm_campaign,
        utm_content: ext.utm_content,
        utm_term: ext.utm_term,
        source: mktg.source,
        medium: mktg.medium,
        campaign: mktg.campaign,
        platform: mktg.platform,
        clickId: mktg.clickId,
        referrer: mktg.referrer,
        referrerDomain: mktg.referrerDomain,
        landingPage: mktg.landingPage,
        timestamp: mktg.timestamp,
        sessionTs: ext.sessionTs,
      });
    };

    foldInto(UTM_FIRST_TOUCH_KEY, LEGACY_MKTG_FIRST_KEY);
    foldInto(UTM_LAST_TOUCH_KEY, LEGACY_MKTG_LAST_KEY);

    // Fold any in-flight pp_utm_session timestamp (v3.2.0 leftover) into
    // pp_utm_last_touch.sessionTs so visitors mid-session don't see an
    // unwanted last-touch rotation on their first v3.3.0 page load. The
    // session window is only 30 min so this only matters for visitors
    // active right at the upgrade boundary, but it's a clean handoff.
    try {
      const sessionRaw = ppLib.getCookie('pp_utm_session');
      if (sessionRaw) {
        const parsed = JSON.parse(sessionRaw);
        const ts = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).ts : null;
        if (typeof ts === 'number' && isFinite(ts)) {
          const lastExt = readStoredExtended(UTM_LAST_TOUCH_KEY);
          if (!lastExt.sessionTs) {
            persistExtended(UTM_LAST_TOUCH_KEY, { ...lastExt, sessionTs: ts });
          }
        }
      }
    } catch (e) { /* best-effort — fall through to deletion */ }

    // Best-effort deletion of the legacy cookies. Uses Max-Age=0 with the
    // configured cookieDomain since the browser only matches deletes against
    // the same Domain attribute the cookie was originally written with;
    // ppLib.deleteCookie covers the host-scoped legacy form for visitors
    // who predate the domain rollout.
    //
    // pp_utm_session is in the list as a one-shot cleanup for v3.2.0 →
    // v3.3.0: the standalone session marker cookie was retired and inlined
    // into pp_utm_last_touch.sessionTs. Visitors who already had the cookie
    // will see it deleted on first builder use; visitors who never had it
    // are unaffected (the delete is a no-op).
    const legacyNames = [LEGACY_MKTG_FIRST_KEY, LEGACY_MKTG_LAST_KEY, 'pp_mktg_session', 'pp_utm_session'];
    for (let i = 0; i < legacyNames.length; i++) {
      const name = legacyNames[i];
      try {
        ppLib.setCookie(name, '', {
          domain: ppLib.config.cookieDomain,
          path: '/',
          maxAgeSeconds: 0,
          sameSite: 'Lax',
        });
      } catch (e) { /* best-effort */ }
      try { ppLib.deleteCookie(name); } catch (e) { /* best-effort */ }
    }

    // Self-disable (F22): the fold + cleanup above has completed, so mark this
    // device done. Written via the same localStorage the fold uses, so the
    // marker only persists when the fold did too. Best-effort — if it fails the
    // shim simply runs again next load (idempotent fold, no-op deletes).
    try { win.localStorage.setItem(MKTG_MIGRATION_DONE_KEY, '1'); } catch (e) { /* best-effort */ }
  }

  /**
   * Apply the pp_mktg-era session veto + first-touch immutability rules to
   * the normalized + visit-metadata slice of an extended touch. Two callers:
   *  - last-touch rotation in captureUtmTouches
   *  - downstream first-touch seeding
   *
   * Returns the slice to PERSIST for last-touch. Rotates when:
   *   - First-ever capture (cookie empty), OR
   *   - New marketing params on this visit, OR
   *   - Session expired AND referrer is NOT self-referral AND the current
   *     visit carries at least one positive signal (a non-empty referrer
   *     OR a URL param). The "no signal" branch is the privacy-mode variant
   *     of audit issues 3.b + 3.c: a Brave / strict-privacy browser that
   *     strips document.referrer on refresh would otherwise read as
   *     `selfReferral=false` and flip last-touch to "direct", silently
   *     losing the original attribution. We can't distinguish "user
   *     genuinely came back direct" from "browser stripped the referrer
   *     on an internal navigation," so we conservatively preserve prior
   *     attribution rather than overwrite it with the weaker "direct"
   *     signal. True new visitors (no prior touch) still go through the
   *     normalizedFirstEver branch and get the direct touch.
   * Otherwise carries the prior normalized slice forward unchanged.
   */
  function shouldRotateLastTouch(
    normalizedFirstEver: boolean,
    hasNewParams: boolean,
    sessionActive: boolean,
    selfReferral: boolean,
    currentHasNoSignal: boolean,
  ): boolean {
    if (normalizedFirstEver) return true;
    if (hasNewParams) return true;
    if (sessionActive) return false;
    if (selfReferral) return false;
    if (currentHasNoSignal) return false;
    return true;
  }

  function resolveNormalizedSlice(
    existingLastExt: ExtendedUtmTouch,
    currentTouch: NormalizedTouch,
    hasNewParams: boolean,
  ): NormalizedTouch {
    // "first-ever" for the normalized slice keys off `platform` (always
    // non-empty after a real write — even direct visits get 'direct'). The
    // literal utm_* slice has its own first-ever check via isFirstEverCapture;
    // the two slices rotate independently because the consolidated cookie
    // can be in mixed states (e.g. legacy localStorage migration seeds only
    // utm_*; pp_mktg_* migration seeds only normalized).
    const normalizedFirstEver = !existingLastExt.platform;
    const sessionActive = isUtmSessionActiveFromExt(existingLastExt);
    const selfReferral = isSelfReferralFromUrl(currentTouch.referrer);
    // No positive attribution signal on this visit — empty referrer AND no
    // URL params. Diverges from GA's "after-timeout direct = new touch"
    // default, by data-team direction: privacy-mode browsers shouldn't
    // silently flip established last-touch to direct.
    const currentHasNoSignal = !currentTouch.referrer && !hasNewParams;
    if (shouldRotateLastTouch(normalizedFirstEver, hasNewParams, sessionActive, selfReferral, currentHasNoSignal)) {
      return currentTouch;
    }
    return {
      source: existingLastExt.source,
      medium: existingLastExt.medium,
      campaign: existingLastExt.campaign,
      platform: existingLastExt.platform,
      clickId: existingLastExt.clickId,
      referrer: existingLastExt.referrer,
      referrerDomain: existingLastExt.referrerDomain,
      landingPage: existingLastExt.landingPage,
      timestamp: existingLastExt.timestamp,
    };
  }

  let utmCaptured = false;
  function captureUtmTouches(): void {
    if (utmCaptured) return;
    utmCaptured = true;

    // Step 0: fold any pre-consolidation pp_mktg_* data into the
    // pp_utm_*_touch normalized slice. Idempotent — only fires when the
    // normalized slice is empty. Must run BEFORE we read existingLastExt
    // so a freshly-migrated cookie informs the firstEver check below.
    migrateLegacyMktgCookiesOnce();

    const urlUtm = readUtmFromUrl();
    const existingLastExt = readStoredExtended(UTM_LAST_TOUCH_KEY);
    const existingFirstExt = readStoredExtended(UTM_FIRST_TOUCH_KEY);
    const firstEver = isFirstEverCapture(projectToRaw(existingLastExt));

    // === Literal utm_* slice — 5-step resolver (Analytics UTM spec) ===
    let resolvedUtm: RawUtmTouch;
    if (firstEver) {
      // First-ever capture — run rules 1–4. ALWAYS persists, even on direct
      // visits, so the "have we ever captured?" signal is durable.
      resolvedUtm = resolveFirstCapture(urlUtm);
    } else {
      // Subsequent capture — URL params overwrite per-key; everything else
      // carries forward. Session rotation does NOT trigger referrer fallbacks
      // here (those only apply on first-ever capture).
      resolvedUtm = projectToRaw(existingLastExt);
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const k = UTM_KEYS[i];
        if (urlUtm[k]) resolvedUtm[k] = urlUtm[k];
      }
    }

    // === Normalized + visit-metadata slice — pp_mktg-era session veto ===
    const params = extractParams(win, ppLib);
    const currentTouch = buildNormalizedTouch(win, params);
    const hasNewParams = hasNewTrafficParams(params);
    const resolvedNormalized = resolveNormalizedSlice(
      existingLastExt, currentTouch, hasNewParams,
    );

    // === Combine and persist last-touch ===
    // sessionTs is refreshed to Date.now() on every capture — this is the
    // 30-min session anchor that resolveNormalizedSlice reads on the next
    // visit to decide whether to rotate or carry forward. Replaces the
    // standalone pp_utm_session cookie that existed in v3.2.0.
    const resolvedLastExt: ExtendedUtmTouch = {
      utm_source: resolvedUtm.utm_source,
      utm_medium: resolvedUtm.utm_medium,
      utm_campaign: resolvedUtm.utm_campaign,
      utm_content: resolvedUtm.utm_content,
      utm_term: resolvedUtm.utm_term,
      source: resolvedNormalized.source,
      medium: resolvedNormalized.medium,
      campaign: resolvedNormalized.campaign,
      platform: resolvedNormalized.platform,
      clickId: resolvedNormalized.clickId,
      referrer: resolvedNormalized.referrer,
      referrerDomain: resolvedNormalized.referrerDomain,
      landingPage: resolvedNormalized.landingPage,
      timestamp: resolvedNormalized.timestamp,
      sessionTs: Date.now(),
    };
    persistExtended(UTM_LAST_TOUCH_KEY, resolvedLastExt);

    // === First-touch immutability — load-bearing, per-slice ===
    // First touch is written exactly ONCE per cookie horizon (2 years) and
    // never overwritten. The guards are load-bearing; do not remove without
    // data-team sign-off.
    //
    // Per-SLICE immutability: the literal utm_* slice and the normalized
    // slice can be filled at different times (legacy localStorage migrated
    // only utm_*; pp_mktg_* migration only fills normalized). Each slice
    // stays locked once it has data, but an empty slice on first-touch
    // still accepts the current capture. This mirrors the pre-consolidation
    // shape where pp_utm_first_touch and pp_mktg_first_touch were
    // independently immutable.
    const literalSliceEmpty = isFirstEverCapture(projectToRaw(existingFirstExt));
    const normalizedSliceEmpty = !existingFirstExt.platform;
    if (literalSliceEmpty || normalizedSliceEmpty) {
      const literalSource = literalSliceEmpty ? resolvedLastExt : existingFirstExt;
      const normalizedSource = normalizedSliceEmpty ? resolvedLastExt : existingFirstExt;
      persistExtended(UTM_FIRST_TOUCH_KEY, {
        utm_source: literalSource.utm_source,
        utm_medium: literalSource.utm_medium,
        utm_campaign: literalSource.utm_campaign,
        utm_content: literalSource.utm_content,
        utm_term: literalSource.utm_term,
        source: normalizedSource.source,
        medium: normalizedSource.medium,
        campaign: normalizedSource.campaign,
        platform: normalizedSource.platform,
        clickId: normalizedSource.clickId,
        referrer: normalizedSource.referrer,
        referrerDomain: normalizedSource.referrerDomain,
        landingPage: normalizedSource.landingPage,
        timestamp: normalizedSource.timestamp,
        sessionTs: 0,
      });
    }

    // Session anchor for last-touch rotation is now inlined as `sessionTs`
    // on the resolvedLastExt persisted above — no separate cookie to touch.
  }

  /**
   * Build the `marketingAttribution` super-property / event-property value
   * from a resolved extended last-touch cookie. Returns null when the
   * normalized slice is empty (canary: `platform`), which happens before
   * captureUtmTouches has run on the current builder instance. Mirrors the
   * legacy MarketingAttribution flat surface — no `firstTouch` / `lastTouch`
   * nested objects (those were always-off in production and the only
   * configure() callers never enabled them).
   */
  function buildMarketingAttributionFromExt(ext: ExtendedUtmTouch): NormalizedTouch | null {
    if (!ext.platform) return null;
    return {
      source: ext.source,
      medium: ext.medium,
      campaign: ext.campaign,
      platform: ext.platform,
      clickId: ext.clickId,
      landingPage: ext.landingPage,
      referrer: ext.referrer,
      referrerDomain: ext.referrerDomain,
      timestamp: ext.timestamp,
    };
  }

  /**
   * Public accessor for the resolved marketing attribution. Used by the
   * mixpanel module to register `marketingAttribution` as a super-property
   * inside the `loaded` callback (where mp is guaranteed live, so no
   * polling needed). Triggers captureUtmTouches so the cookie is resolved
   * on demand — order-independent with build().
   */
  function getMarketingAttribution(): NormalizedTouch | null {
    captureUtmTouches();
    return buildMarketingAttributionFromExt(readStoredExtended(UTM_LAST_TOUCH_KEY));
  }

  // Each getter triggers captureUtmTouches() so the persistence runs on the
  // first call regardless of whether build() was invoked first. Capture is
  // idempotent (guarded by utmCaptured), so this stays a one-time cost per
  // builder instance.
  function getCurrentUtm(): RawUtmTouch {
    captureUtmTouches();
    return readUtmFromUrl();
  }
  function getFirstTouchUtm(): RawUtmTouch {
    captureUtmTouches();
    return readStoredUtm(UTM_FIRST_TOUCH_KEY);
  }
  function getLastTouchUtm(): RawUtmTouch {
    captureUtmTouches();
    return readStoredUtm(UTM_LAST_TOUCH_KEY);
  }

  // Per the Analytics UTM events spec, utm_source / utm_medium / utm_campaign
  // default to '$direct' when no value is set; utm_content and utm_term
  // default to 'none' so consumers can distinguish "direct traffic with no
  // creative/keyword context" from "creative/keyword genuinely absent". This
  // fills any legacy partial data with the spec default; freshly-captured
  // users already have the correct defaults baked into the resolved
  // persisted value.
  function utmOrFallback(touch: RawUtmTouch, key: keyof RawUtmTouch): string {
    return touch[key] || utmFallback(key);
  }

  function buildStable() {
    if (stableCache) return stableCache;
    const ua = (win.navigator && win.navigator.userAgent) || '';
    stableCache = {
      browser: parseBrowser(ua),
      device_type: parseDeviceType(ua),
      device: parseDevice(ua),
      country: ppLib.getCookie(cookieNames.country) || '',
    };
    return stableCache;
  }

  function determineLoginState(): { userId: string; patientId: string; isLoggedIn: boolean; appIsAuthenticated: boolean } {
    const userId = ppLib.getCookie(cookieNames.userId) || '';
    const patientId = ppLib.getCookie(cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(cookieNames.appAuth) || '';
    return {
      userId: userId,
      patientId: patientId,
      isLoggedIn: deriveLoggedIn(userId),
      appIsAuthenticated: deriveIsAuthenticated(appAuth),
    };
  }

  function buildClickIdAttribution(params: URLSearchParams): BuiltAttribution {
    return {
      fbclid: params.get('fbclid') || null,
      fbc: ppLib.getCookie('_fbc') || null,
      fbp: ppLib.getCookie('_fbp') || null,
      gclid: params.get('gclid') || null,
      gbraid: params.get('gbraid') || null,
      wbraid: params.get('wbraid') || null,
      ttclid: params.get('ttclid') || null,
      epik: params.get('epik') || null,
      rdt_cid: params.get('rdt_cid') || null,
    };
  }

  function build(): BuiltEventBundle {
    const stable = buildStable();
    const deviceId = getOrCreateDeviceId();
    captureUtmTouches();

    const { userId, patientId, isLoggedIn, appIsAuthenticated } = determineLoginState();

    // Literal utm_* params — intentionally NOT routed through the normalized
    // resolver, so e.g. `?source=febpt` does NOT populate utm_source. The
    // normalized slice of the same extended cookie carries the alias-resolved
    // view for marketingAttribution / referrer / landing_page bracket props.
    const currentUtm = readUtmFromUrl();
    const firstExt = readStoredExtended(UTM_FIRST_TOUCH_KEY);
    const lastExt = readStoredExtended(UTM_LAST_TOUCH_KEY);
    const firstUtm = projectToRaw(firstExt);
    const lastUtm = projectToRaw(lastExt);

    const userProperties: BuiltUserProperties = {
      userId: userId,
      patientId: patientId,
      pp_distinct_id: isLoggedIn ? userId : deviceId
    };

    const eventProperties: BuiltEventProperties = {
      // Per the event-attribute contract:
      //   url         = full href of the page, but PII-sanitized — the
      //                 PII_QUERY_PARAM_DENYLIST params (access_token, email,
      //                 otp, patient_id, rx_number, …) and the #fragment are
      //                 stripped before this leaves for Mixpanel / GA4. On a
      //                 pharmacy domain a magic-link / password-reset / patient
      //                 deep-link landing must NOT exfiltrate those verbatim.
      //                 Non-PII params (utm_*, etc.) are preserved. Mirrors the
      //                 sanitization already applied to `landingPage`.
      //   current_url = generic URL after removing params (pathname)
      // The nested page.url (BuiltPage) stays as pathname — matches the
      // contract sample shape.
      url: sanitizeLandingPage((win.location && win.location.href) || '/'),
      current_url: win.location.pathname || '/',
      device_id: deviceId,
      // Anonymous visitors (no cookie, or the main app's '-1' logged-out
      // sentinel) emit `null` rather than a string id. `null` is normally
      // dropped by 3E's strip, but `pp_user_id` / `pp_patient_id` are on the
      // ALLOW_NULL list in `stripEmptyProps`, so the explicit null is
      // preserved and stays queryable / filterable in Mixpanel and GA4.
      pp_user_id: isValidUserId(userId) ? parseInt(userId, 10) : null,
      pp_patient_id: isValidUserId(patientId) ? parseInt(patientId, 10) : null,
      pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
      pp_timestamp: Date.now(),
      platform: defaultPlatform,
      logged_in: toLoggedInString(isLoggedIn),
      app_is_authenticated: appIsAuthenticated,

      // Current UTM — literal URL params with Mixpanel-style $direct/none
      // fallbacks for consistency with [first touch] / [last touch] keys.
      utm_source: utmOrFallback(currentUtm, 'utm_source'),
      utm_medium: utmOrFallback(currentUtm, 'utm_medium'),
      utm_campaign: utmOrFallback(currentUtm, 'utm_campaign'),

      // First touch UTM — snapshot of the resolved last-touch at first-ever
      // capture; locked thereafter (also enforced via Mixpanel register_once
      // / set_once on the Mixpanel side).
      [UTM_FIRST_TOUCH.source]: utmOrFallback(firstUtm, 'utm_source'),
      [UTM_FIRST_TOUCH.medium]: utmOrFallback(firstUtm, 'utm_medium'),
      [UTM_FIRST_TOUCH.campaign]: utmOrFallback(firstUtm, 'utm_campaign'),
      [UTM_FIRST_TOUCH.content]: utmOrFallback(firstUtm, 'utm_content'),
      [UTM_FIRST_TOUCH.term]: utmOrFallback(firstUtm, 'utm_term'),

      // Last touch UTM — resolved via the 5-step spec (URL → search engine
      // → external referrer → $direct → carry forward).
      [UTM_LAST_TOUCH.source]: utmOrFallback(lastUtm, 'utm_source'),
      [UTM_LAST_TOUCH.medium]: utmOrFallback(lastUtm, 'utm_medium'),
      [UTM_LAST_TOUCH.campaign]: utmOrFallback(lastUtm, 'utm_campaign'),
      [UTM_LAST_TOUCH.content]: utmOrFallback(lastUtm, 'utm_content'),
      [UTM_LAST_TOUCH.term]: utmOrFallback(lastUtm, 'utm_term'),

      // User context
      Country: stable.country,
      browser: stable.browser,
      device_type: stable.device_type,
      Device: stable.device,
      referrer: extractDomain(win.document.referrer),
      // initial_referrer comes from the first-touch cookie's normalized slice
      // (referrer is not a UTM concept). Empty string when first-touch hasn't
      // been captured yet (i.e. build() called before captureUtmTouches).
      initial_referrer: firstExt.referrer,

      // Marketing attribution — the normalized view (handles source=, gclid, …).
      // Built inline from the resolved last-touch cookie; session-veto +
      // self-referral logic has already been applied by captureUtmTouches.
      [MARKETING_ATTRIBUTION_KEY]: buildMarketingAttributionFromExt(lastExt),

      // 1C touch attributes (data-team contract). Distinct from utm_*: the
      // normalized slice captures these once per touch (first + last),
      // including the full referring URL, its hostname, and the full
      // landing-page URL. Mirrors the bracket convention used for utm_*.
      'referrer [first touch]': firstExt.referrer,
      'referrer [last touch]': lastExt.referrer,
      'referrer_domain [first touch]': firstExt.referrerDomain,
      'referrer_domain [last touch]': lastExt.referrerDomain,
      'landing_page_url [first touch]': firstExt.landingPage,
      'landing_page_url [last touch]': lastExt.landingPage,

      // pp_initial_* — SDK-owned backup mirroring Mixpanel's native
      // $initial_referrer / $initial_referring_domain. Those freeze (register_once)
      // on the device's first MP-cookie contact and read $direct when that visit
      // was direct, even if the SDK later captured a real referrer on a different
      // visit (cookie vs localStorage clear independently). These carry the SDK's
      // authoritative first-touch referrer from pp_utm_first_touch (localStorage),
      // unstripped for Mixpanel, so analysts always have a trustworthy column.
      // Empty (a genuinely-direct first touch) is stripped like the bracket fields.
      'pp_initial_referrer': firstExt.referrer,
      'pp_initial_referring_domain': firstExt.referrerDomain,
    };

    const page: BuiltPage = {
      url: win.location.pathname || '/',
      title: win.document.title || '',
      referrer: win.document.referrer || ''
    };

    // Reuse the memoized URLSearchParams from getSearchParams — keyed on
    // the raw URL so navigation invalidates correctly.
    const params = getSearchParams((win.document && win.document.URL) || win.location.href || '');
    const attribution = buildClickIdAttribution(params);

    return { userProperties: userProperties, eventProperties: eventProperties, page: page, attribution: attribution };
  }

  function buildFlat(): Record<string, unknown> {
    const bundle = build();
    const flat: Record<string, unknown> = {};

    // userProperties first, then eventProperties — eventProperties wins on
    // overlapping keys (none today, but safe ordering for future fields).
    const userObj = bundle.userProperties as unknown as Record<string, unknown>;
    const userKeys = Object.keys(userObj);
    for (let i = 0; i < userKeys.length; i++) {
      flat[userKeys[i]] = userObj[userKeys[i]];
    }
    // Per the data-team contract, every event payload carries the full
    // property bag — including utm_* [first/last touch] and marketingAttribution.
    // Mixpanel also registers these as super-properties; the redundancy is
    // intentional so dataLayer / GTM / BigQuery consumers see the same data
    // as Mixpanel reports without depending on the super-property side channel.
    const eventObj = bundle.eventProperties as unknown as Record<string, unknown>;
    const eventKeys = Object.keys(eventObj);
    for (let j = 0; j < eventKeys.length; j++) {
      const k = eventKeys[j];
      flat[k] = eventObj[k];
    }

    // Ad-platform click IDs — useful per-event for downstream conversion attribution.
    const attrObj = bundle.attribution as unknown as Record<string, unknown>;
    const attrKeys = Object.keys(attrObj);
    for (let n = 0; n < attrKeys.length; n++) {
      const ak = attrKeys[n];
      const av = attrObj[ak];
      if (av !== null && av !== undefined) flat[ak] = av;
    }

    // Strip the snake_case fields that duplicate Mixpanel's own auto-
    // collected `$`-prefixed properties. The Mixpanel UI surfaces those
    // auto-properties under title-case display names ("Browser", "Current
    // URL", "Device", "Initial Referrer", etc.) — keeping our snake_case
    // copies alongside produces two columns per dimension in event-
    // property panels and confuses reports. dataLayer / GTM consumers
    // still receive them via `build()`; only the Mixpanel-bound payload
    // (this `buildFlat` output) is pruned.
    const dupKeys = Array.from(MIXPANEL_DUPLICATE_KEYS);
    for (let m = 0; m < dupKeys.length; m++) {
      delete flat[dupKeys[m]];
    }

    // 3E: strip null / undefined / empty-string before sending to Mixpanel.
    // Mixpanel ingests empty strings as legitimate values, which pollutes
    // funnels with "(empty)" segments. The builder's UTM fallback already
    // produces '$direct' for direct visits (not ''), so this only catches
    // unset cookies / login-state-dependent fields / unset attribution.
    return stripEmptyProps(flat);
  }

  // Nested-wrapper shape: same four blocks the dataLayer enricher emits,
  // hoisted to the top level of a fresh object. The end-state contract
  // shape — Mixpanel's `nested` and `dual` modes use this. 3E: each
  // sub-bag is stripped of null/undefined/empty before being wrapped.
  function buildNested(): Record<string, unknown> {
    const bundle = build();
    return {
      page: stripEmptyProps(bundle.page as unknown as Record<string, unknown>),
      userProperties: stripEmptyProps(bundle.userProperties as unknown as Record<string, unknown>),
      eventProperties: stripEmptyProps(bundle.eventProperties as unknown as Record<string, unknown>),
      attribution: stripEmptyProps(bundle.attribution as unknown as Record<string, unknown>),
    };
  }

  // Eagerly trigger the cookie → localStorage migration for UTM touches.
  // createLocalStorageValue's read() migrates the cookie on first access
  // and deletes it — running this at builder creation ensures the cookies
  // are removed from the header before any user navigation.
  utmFirstTouchStore.read();
  utmLastTouchStore.read();

  return {
    configure: configure,
    build: build,
    buildFlat: buildFlat,
    buildNested: buildNested,
    getCurrentUtm: getCurrentUtm,
    getFirstTouchUtm: getFirstTouchUtm,
    getLastTouchUtm: getLastTouchUtm,
    getMarketingAttribution: getMarketingAttribution,
  };
}
