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
 * Stable per-session fields (browser, device_type, country, device_id) are
 * memoized; volatile fields (URL, referrer, login state, attribution) are
 * recomputed on each build() call.
 */
import type { PPLib } from '@src/types/common.types';
import type { DeepPartial } from '@src/types/utility.types';
import {
  UTM_FIRST_TOUCH,
  UTM_LAST_TOUCH,
  MARKETING_ATTRIBUTION_KEY,
} from '@src/common/super-property-keys';
import { createPersistentValue } from '@src/common/persistent-storage';

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
  pp_user_id: string;
  pp_patient_id: string;
  pp_session_id: string;
  pp_timestamp: number;
  platform: string;
  // Stringified boolean ("true"/"false") per the event-attribute contract —
  // consumers (Mixpanel, GTM, BigQuery) treat the value as a categorical
  // string, not a boolean. The internal closure variable stays boolean.
  logged_in: string;
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
   * analysts use `device` for the model breakdown and `device_type` for
   * the form-factor breakdown — both are needed.
   */
  device: string;
  referrer: string;
  initial_referrer: string;
  marketing_attribution: unknown;
  // 1C touch attributes — captured by the attribution service. Full URL,
  // its hostname, and the full landing URL, for both first and last touch.
  'referrer [first touch]': string;
  'referrer [last touch]': string;
  'referrer_domain [first touch]': string;
  'referrer_domain [last touch]': string;
  'landing_page_url [first touch]': string;
  'landing_page_url [last touch]': string;
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

export type RawUtmTouch = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
};

/**
 * Extended UTM touch — the cookie shape that replaces the old literal-only
 * `RawUtmTouch` and the separate `pp_mktg_*_touch` cookies. Each persisted
 * touch carries three slices:
 *
 *   1. utm_* — literal URL params (RawUtmTouch contract; unchanged).
 *   2. Normalized — source/medium/campaign with alias resolution, plus
 *      platform / clickId derived from click IDs, utm_source, and the
 *      referrer. This is the slice that previously lived in pp_mktg_*.
 *   3. Visit metadata — referrer / referrerDomain / landingPage / timestamp
 *      captured at touch time.
 *
 * Phase 1 only writes the literal slice; the normalized + visit-metadata
 * fields default to '' so the new shape round-trips through cookies but
 * doesn't yet alter behaviour. Phase 3 wires up population.
 */
export type ExtendedUtmTouch = RawUtmTouch & {
  source: string;
  medium: string;
  campaign: string;
  platform: string;
  clickId: string;
  referrer: string;
  referrerDomain: string;
  landingPage: string;
  timestamp: string;
};

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
}

// Per Analytics events spec (3E): strip null / undefined / '' values from
// property bags before they leave the SDK. Mixpanel ingestion treats
// empty strings as legitimate values, polluting funnels with "(empty)"
// segments; null/undefined breaks BigQuery exports. Stripping at the
// builder boundary is cheaper than stripping at every dispatcher.
// Pure: returns a fresh object; does NOT mutate the input.
export function stripEmptyProps(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = input[k];
    if (v === null || v === undefined) continue;
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
  // anonymous tracking UUID. Different VALUE from our pp_device_id but
  // user asked to dedupe the column. The pp_device_id value still rides
  // as pp_distinct_id and surfaces as "Distinct ID Before Identity".
  'device_id',
  // current_url — Mixpanel auto: $current_url ("Current URL") shows the
  // full URL. Ours is path-only, but visually duplicates the column.
  // The path-only view is still available under page_path.
  'current_url',
  // referrer — Mixpanel auto: $referrer / $referring_domain ("Initial
  // Referrer" / "Initial Referring Domain") cover the per-event referrer.
  'referrer',
  'initial_referrer',
  // NOTE intentionally NOT stripped:
  //   - Plain (non-bracket) `utm_source` / `utm_medium` / `utm_campaign`:
  //     Mixpanel's built-in `track_marketing` already auto-captures these
  //     from the URL as the "UTM Source" / "UTM Medium" / "UTM Campaign"
  //     columns; our SDK ALSO sends them in `eventProperties` (with a
  //     `$direct` fallback for direct visits) for cross-tool parity with
  //     dataLayer / GA4. Same key, same value — Mixpanel merges without
  //     duplication.
  //   - `device`: Mixpanel's $device only fills on mobile (device model
  //     like "iPhone"/"Android"); on desktop it's empty. Our `device`
  //     fills both ("MacBook" / "Android") so it covers the gap.
  //   - `device_type`: no Mixpanel equivalent — "desktop"/"mobile"/
  //     "tablet" is unique to our SDK.
]);

const DEVICE_ID_KEY = 'pp_device_id';
const UTM_FIRST_TOUCH_KEY = 'pp_utm_first_touch';
const UTM_LAST_TOUCH_KEY = 'pp_utm_last_touch';
const UTM_KEYS: ReadonlyArray<keyof RawUtmTouch> = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// ---------------------------------------------------------------------------
// 5-step UTM resolution helpers (Analytics UTM events spec).
//
// Search-engine names — matched against the referrer hostname using a
// "dot or start of segment, then engine token, then dot" pattern so we hit
// regional TLDs (`google.co.uk`, `bing.co.in`) and subdomains
// (`images.google.com`) but NOT bogus collisions like `googleads.example.com`
// (their token isn't followed by a dot leading into the TLD). The token
// list mirrors the attribution service's ORGANIC_SEARCH_DOMAINS plus a few
// more (ecosia / brave) commonly cited in the data team's prior reports.
// ---------------------------------------------------------------------------
export const SEARCH_ENGINE_PATTERNS: ReadonlyArray<{ token: string; name: string }> = [
  { token: 'google', name: 'google' },
  { token: 'bing', name: 'bing' },
  { token: 'yahoo', name: 'yahoo' },
  { token: 'duckduckgo', name: 'duckduckgo' },
  { token: 'baidu', name: 'baidu' },
  { token: 'yandex', name: 'yandex' },
  { token: 'ecosia', name: 'ecosia' },
  { token: 'brave', name: 'brave' },
];

/**
 * Recognise a search-engine referrer by hostname. Returns the canonical
 * engine name (`google` / `bing` / …) or null. Match rule:
 *   <start-of-host or `.`> <engine token> `.` …
 * Engine token must be followed by a dot to avoid matching e.g. `googleads`.
 */
export function getSearchEngineName(refHost: string): string | null {
  if (!refHost) return null;
  const h = refHost.toLowerCase();
  for (let i = 0; i < SEARCH_ENGINE_PATTERNS.length; i++) {
    const t = SEARCH_ENGINE_PATTERNS[i].token;
    // Anchor: start-of-string OR preceded by '.'; then the token followed by '.'
    const idx = h.indexOf(t + '.');
    if (idx === -1) continue;
    if (idx === 0 || h.charAt(idx - 1) === '.') return SEARCH_ENGINE_PATTERNS[i].name;
  }
  return null;
}

/**
 * Multi-part public-suffix exception list (Option C hybrid). Anything in this
 * set causes `getRootDomain` to return the last THREE labels instead of two
 * (so `news.bbc.co.uk` → `bbc.co.uk`, not `co.uk`). Curated for the regions
 * we actually see traffic from; falls back gracefully to the last-2 default
 * for anything not listed.
 */
export const MULTI_PART_TLDS: ReadonlySet<string> = new Set([
  'co.uk', 'co.jp', 'co.kr', 'co.in', 'co.nz', 'co.za', 'co.il', 'co.id',
  'co.th', 'co.cr', 'co.ve',
  'com.au', 'com.br', 'com.cn', 'com.hk', 'com.mx', 'com.sg', 'com.tr',
  'com.tw', 'com.ar', 'com.ph', 'com.my', 'com.pl', 'com.vn', 'com.co',
  'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ne.jp', 'or.jp', 'ac.jp',
  'ac.in', 'gov.in', 'net.au', 'org.au', 'gov.au',
]);

/**
 * Extract the registrable root domain from a hostname. Hybrid strategy:
 *   - Default: take the last two labels (`news.example.com` → `example.com`).
 *   - If the last two labels match a multi-part-TLD entry, take the last three
 *     (`news.bbc.co.uk` → `bbc.co.uk`).
 *
 * Returns the hostname unchanged for single-label inputs and the empty string
 * for empty input. Public Suffix List proper would be more complete but adds
 * ~30KB; the hybrid covers our actual traffic with ~500 bytes of data.
 */
export function getRootDomain(hostname: string): string {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length < 2) return hostname;
  const last2 = parts.slice(-2).join('.').toLowerCase();
  if (MULTI_PART_TLDS.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// Two-year max-age — device_id is a long-lived anonymous identifier; matches
// the prior localStorage durability (effectively permanent until cleared).
const DEVICE_ID_MAX_AGE_SECONDS = 63072000;
// First touch UTM — 2 years, mirrors the device_id horizon. First-touch
// attribution is by definition long-lived and we want it to survive
// re-engagement campaigns.
const UTM_FIRST_TOUCH_MAX_AGE_SECONDS = 63072000;
// Last touch UTM — 30 days. Matches the standard Mixpanel/GA "last touch"
// attribution window so analytics tools agree on which campaign gets credit.
const UTM_LAST_TOUCH_MAX_AGE_SECONDS = 2592000;

// Keys of the normalized + visit-metadata slices of `ExtendedUtmTouch`.
// Centralised so parseUtmTouch / emptyExtended / projection helpers stay
// in lockstep when the schema grows.
const EXTENDED_TOUCH_EXTRA_KEYS: ReadonlyArray<keyof ExtendedUtmTouch> = [
  'source', 'medium', 'campaign', 'platform', 'clickId',
  'referrer', 'referrerDomain', 'landingPage', 'timestamp',
];

/**
 * Deserialize a `pp_utm_*_touch` cookie value. Accepts both the legacy
 * literal-only shape (`RawUtmTouch`) and the new `ExtendedUtmTouch`;
 * missing fields default to '' so pre-existing cookies self-upgrade on
 * the next write without going through a null/regenerate cycle.
 *
 * Returns null only when the input isn't a JSON object — any object with
 * at least string-typed UTM keys passes. The empty-string fill makes the
 * `ExtendedUtmTouch` contract uniform: callers never need to distinguish
 * "field missing" from "field empty".
 */
function parseUtmTouch(raw: string): ExtendedUtmTouch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const out: ExtendedUtmTouch = emptyExtended();
    for (let i = 0; i < UTM_KEYS.length; i++) {
      const k = UTM_KEYS[i];
      const v = obj[k];
      out[k] = typeof v === 'string' ? v : '';
    }
    for (let i = 0; i < EXTENDED_TOUCH_EXTRA_KEYS.length; i++) {
      const k = EXTENDED_TOUCH_EXTRA_KEYS[i];
      const v = obj[k];
      (out as Record<string, string>)[k] = typeof v === 'string' ? v : '';
    }
    return out;
  } catch (e) {
    return null;
  }
}

function generateDeviceUuid(win: Window & typeof globalThis): string {
  try {
    if (typeof win.crypto !== 'undefined' && typeof win.crypto.randomUUID === 'function') {
      return win.crypto.randomUUID();
    }
  } catch (e) { /* fallback below */ }
  try {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  } catch (e) {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 11);
  }
}

function emptyUtm(): RawUtmTouch {
  return { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };
}

function emptyExtended(): ExtendedUtmTouch {
  return {
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    source: '', medium: '', campaign: '', platform: '', clickId: '',
    referrer: '', referrerDomain: '', landingPage: '', timestamp: '',
  };
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
  let stableCache: { browser: string; device_type: string; device: string; country: string; device_id: string } | null = null;

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

  // Cross-subdomain device_id storage. Cookie-first read with one-time
  // migration from the legacy localStorage entry, so users hopping between
  // try.pocketpills.com and www.pocketpills.com keep the same anonymous ID.
  const deviceIdStore = createPersistentValue<string>(win, ppLib, {
    cookieName: DEVICE_ID_KEY,
    maxAgeSeconds: DEVICE_ID_MAX_AGE_SECONDS,
    serialize: (s) => s,
    deserialize: (s) => (typeof s === 'string' && s.length > 0) ? s : null,
    generate: () => generateDeviceUuid(win),
    legacyLocalStorageKey: DEVICE_ID_KEY
  });

  function getOrCreateDeviceId(): string {
    try {
      return deviceIdStore.read() || '';
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
    if (lower.indexOf('mobi') !== -1 || lower.indexOf('android') !== -1 && lower.indexOf('mobile') !== -1) return 'mobile';
    if (lower.indexOf('android') !== -1) return 'tablet';
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

  // The SDK emits `country` as an ISO-2 code (e.g. "CA") for cross-tool
  // joins (Mixpanel, Braze, GA, BigQuery exports). This is INTENTIONALLY
  // distinct from the geo-derived properties Mixpanel auto-attaches to
  // every event from server-side IP lookup — those appear in the raw
  // payload as `mp_country_code` ("CA") and are shown in Mixpanel's UI
  // with the full-name label "Country: Canada". The two coexist by design;
  // analysts querying our SDK should use lowercase `country`.
  //
  // Source: cookie only. We deliberately do NOT fall back to
  // navigator.language — it reflects the browser's UI language (often
  // "en-US" by default on Chrome regardless of physical location) and
  // produces confidently-wrong values. When the cookie is empty we leave
  // `country` empty rather than ship fake data; analysts can rely on
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

  // Cross-subdomain UTM touch storage. First-touch + last-touch attribution
  // must travel with the user across try.pocketpills.com ↔ www.pocketpills.com
  // so the persisted source/medium/campaign matches the visit that actually
  // attributed the conversion. Read-first: if a cookie exists, it wins; the
  // legacy localStorage JSON is migrated on first access and purged.
  const utmFirstTouchStore = createPersistentValue<ExtendedUtmTouch>(win, ppLib, {
    cookieName: UTM_FIRST_TOUCH_KEY,
    maxAgeSeconds: UTM_FIRST_TOUCH_MAX_AGE_SECONDS,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseUtmTouch,
    legacyLocalStorageKey: UTM_FIRST_TOUCH_KEY
  });

  const utmLastTouchStore = createPersistentValue<ExtendedUtmTouch>(win, ppLib, {
    cookieName: UTM_LAST_TOUCH_KEY,
    maxAgeSeconds: UTM_LAST_TOUCH_MAX_AGE_SECONDS,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseUtmTouch,
    legacyLocalStorageKey: UTM_LAST_TOUCH_KEY
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

  // Projection helper — strips the extended slices back down to the
  // literal-only shape consumed by callers that haven't been migrated yet
  // (the `RawUtmTouch` half of build() and the public getFirstTouchUtm /
  // getLastTouchUtm getters). Phase 4 will widen the public API to return
  // ExtendedUtmTouch directly and delete this.
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
  //                                    utm_campaign/content/term = '$direct'.
  //   3. Else external (non-self) referrer → utm_source = root domain,
  //                                          utm_medium = 'referral',
  //                                          utm_campaign/content/term = '$direct'.
  //   4. Else no referrer → all keys = '$direct'.
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
      utm_content: urlUtm.utm_content || '$direct',
      utm_term: urlUtm.utm_term || '$direct',
    };
  }

  function isFirstEverCapture(stored: RawUtmTouch): boolean {
    for (let i = 0; i < UTM_KEYS.length; i++) {
      if (stored[UTM_KEYS[i]] !== '') return false;
    }
    return true;
  }

  let utmCaptured = false;
  function captureUtmTouches(): void {
    if (utmCaptured) return;
    utmCaptured = true;

    const urlUtm = readUtmFromUrl();
    const existingLastExt = readStoredExtended(UTM_LAST_TOUCH_KEY);
    const firstEver = isFirstEverCapture(projectToRaw(existingLastExt));

    let resolvedUtm: RawUtmTouch;
    if (firstEver) {
      // First-ever capture — run rules 1–4. ALWAYS persists, even on direct
      // visits, so the "have we ever captured?" signal is durable.
      resolvedUtm = resolveFirstCapture(urlUtm);
    } else {
      // Subsequent capture — URL params overwrite per-key; everything else
      // carries forward. Session rotation does NOT trigger referrer fallbacks.
      resolvedUtm = projectToRaw(existingLastExt);
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const k = UTM_KEYS[i];
        if (urlUtm[k]) resolvedUtm[k] = urlUtm[k];
      }
    }

    // Compose into the extended shape — preserve any normalized / visit
    // fields that were already on the cookie (Phase 3 will populate them
    // here; Phase 1 just round-trips whatever's there).
    const resolvedExt: ExtendedUtmTouch = {
      utm_source: resolvedUtm.utm_source,
      utm_medium: resolvedUtm.utm_medium,
      utm_campaign: resolvedUtm.utm_campaign,
      utm_content: resolvedUtm.utm_content,
      utm_term: resolvedUtm.utm_term,
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
    persistExtended(UTM_LAST_TOUCH_KEY, resolvedExt);

    // First-touch: set once from the resolved last-touch value. Locked
    // thereafter — 3C hardens this on the Mixpanel side via register_once /
    // set_once so cross-session reseeding is impossible even if a cookie
    // somehow gets cleared.
    const existingFirstExt = readStoredExtended(UTM_FIRST_TOUCH_KEY);
    if (isFirstEverCapture(projectToRaw(existingFirstExt))) {
      persistExtended(UTM_FIRST_TOUCH_KEY, resolvedExt);
    }
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

  // Per the Analytics UTM events spec, every utm_* [first/last touch] key
  // defaults to '$direct' when no value is set (not 'none'). This fills any
  // legacy partial data with the spec default; freshly-captured users already
  // have '$direct' baked into the resolved persisted value.
  function utmOrFallback(touch: RawUtmTouch, key: keyof RawUtmTouch): string {
    return touch[key] || '$direct';
  }

  function buildStable() {
    if (stableCache) return stableCache;
    const ua = (win.navigator && win.navigator.userAgent) || '';
    stableCache = {
      browser: parseBrowser(ua),
      device_type: parseDeviceType(ua),
      device: parseDevice(ua),
      country: ppLib.getCookie(cookieNames.country) || '',
      device_id: getOrCreateDeviceId()
    };
    return stableCache;
  }

  function build(): BuiltEventBundle {
    const stable = buildStable();
    captureUtmTouches();

    const userId = ppLib.getCookie(cookieNames.userId) || '';
    const patientId = ppLib.getCookie(cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(cookieNames.appAuth) || '';
    const isLoggedIn = appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId);

    // Literal utm_* params — intentionally NOT routed through the attribution
    // service's normalization, so e.g. `?source=febpt` does NOT populate
    // utm_source. The attribution service still normalizes for
    // marketing_attribution below.
    const currentUtm = readUtmFromUrl();
    const firstUtm = readStoredUtm(UTM_FIRST_TOUCH_KEY);
    const lastUtm = readStoredUtm(UTM_LAST_TOUCH_KEY);

    const firstTouchAttr = ppLib.attribution ? ppLib.attribution.getFirstTouch() : null;
    const lastTouchAttr = ppLib.attribution ? ppLib.attribution.getLastTouch() : null;

    const userProperties: BuiltUserProperties = {
      userId: userId,
      patientId: patientId,
      pp_distinct_id: isLoggedIn ? userId : stable.device_id
    };

    const eventProperties: BuiltEventProperties = {
      // Per the event-attribute contract:
      //   url         = exact URL of the page being visited (full href)
      //   current_url = generic URL after removing params (pathname)
      // The nested page.url (BuiltPage) stays as pathname — matches the
      // contract sample shape.
      url: win.location.href,
      current_url: win.location.pathname || '/',
      device_id: stable.device_id,
      // Anonymous visitors get the '-1' sentinel (matches the convention
      // used by `isLoggedIn` above and the main app's cookie format) so
      // these fields survive 3E's empty-string strip and remain queryable
      // / filterable in Mixpanel for anonymous segments.
      pp_user_id: userId || '-1',
      pp_patient_id: patientId || '-1',
      pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
      pp_timestamp: Date.now(),
      platform: defaultPlatform,
      logged_in: isLoggedIn ? 'true' : 'false',

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
      device: stable.device,
      referrer: extractDomain(win.document.referrer),
      // initial_referrer still comes from the attribution service's first-touch
      // (referrer is not a UTM concept).
      initial_referrer: firstTouchAttr ? firstTouchAttr.referrer : '',

      // Marketing attribution — the normalized view (handles source=, gclid, …).
      [MARKETING_ATTRIBUTION_KEY]: ppLib.attribution ? ppLib.attribution.get() : null,

      // 1C touch attributes (data-team contract). Distinct from utm_*: the
      // attribution service captures these once per touch (first + last),
      // including the full referring URL, its hostname, and the full
      // landing-page URL. Mirrors the bracket convention used for utm_*.
      'referrer [first touch]': firstTouchAttr ? firstTouchAttr.referrer : '',
      'referrer [last touch]': lastTouchAttr ? lastTouchAttr.referrer : '',
      'referrer_domain [first touch]': firstTouchAttr ? firstTouchAttr.referrerDomain : '',
      'referrer_domain [last touch]': lastTouchAttr ? lastTouchAttr.referrerDomain : '',
      'landing_page_url [first touch]': firstTouchAttr ? firstTouchAttr.landingPage : '',
      'landing_page_url [last touch]': lastTouchAttr ? lastTouchAttr.landingPage : '',
    };

    const page: BuiltPage = {
      url: win.location.pathname || '/',
      title: win.document.title || '',
      referrer: win.document.referrer || ''
    };

    // Reuse the memoized URLSearchParams from getSearchParams — keyed on
    // the raw URL so navigation invalidates correctly.
    const params = getSearchParams((win.document && win.document.URL) || win.location.href || '');
    const attribution: BuiltAttribution = {
      fbclid: params.get('fbclid') || null,
      fbc: ppLib.getCookie('_fbc') || null,
      fbp: ppLib.getCookie('_fbp') || null,
      gclid: params.get('gclid') || null,
      gbraid: params.get('gbraid') || null,
      wbraid: params.get('wbraid') || null,
      ttclid: params.get('ttclid') || null,
      epik: params.get('epik') || null,
      rdt_cid: params.get('rdt_cid') || null
    };

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
    // property bag — including utm_* [first/last touch] and marketing_attribution.
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

  return {
    configure: configure,
    build: build,
    buildFlat: buildFlat,
    buildNested: buildNested,
    getCurrentUtm: getCurrentUtm,
    getFirstTouchUtm: getFirstTouchUtm,
    getLastTouchUtm: getLastTouchUtm
  };
}
