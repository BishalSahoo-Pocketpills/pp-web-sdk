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
 * Extended UTM touch — the consolidated cookie shape for marketing
 * attribution. Each persisted touch carries three slices:
 *
 *   1. utm_* — literal URL params (RawUtmTouch contract).
 *   2. Normalized — source/medium/campaign with alias resolution, plus
 *      platform / clickId derived from click IDs, utm_source, and the
 *      referrer.
 *   3. Visit metadata — referrer / referrerDomain / landingPage / timestamp
 *      captured at touch time.
 *
 * The two non-literal slices (normalized + visit metadata) replace the
 * separate pp_mktg_*_touch cookies that the legacy attribution service
 * managed. The slices rotate independently in captureUtmTouches so the
 * cookie can carry a literal capture from one visit and a normalized
 * capture from another.
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
  /**
   * Session anchor for normalized last-touch rotation. Inlined from the
   * (now-retired) standalone `pp_utm_session` cookie. Refreshed on every
   * captureUtmTouches; treated as "session inactive" when 0 or > 30 min old.
   *
   * Carried on pp_utm_last_touch only — on pp_utm_first_touch it's persisted
   * but never read (first-touch is locked, no rotation logic depends on it).
   */
  sessionTs: number;
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
      // Cast via `unknown` because ExtendedUtmTouch now contains a numeric
      // field (sessionTs) alongside the strings; the keys in
      // EXTENDED_TOUCH_EXTRA_KEYS are still all-string, but the wider type
      // no longer admits a `Record<string, string>` cast directly.
      (out as unknown as Record<string, string>)[k] = typeof v === 'string' ? v : '';
    }
    // sessionTs is the only numeric field — pre-v3.3.0 cookies don't have it
    // (sentinel 0 falls into "session inactive" naturally on first read).
    const ts = obj.sessionTs;
    out.sessionTs = typeof ts === 'number' && isFinite(ts) ? ts : 0;
    return out;
  } catch (e) {
    return null;
  }
}

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
    sessionTs: 0,
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

// ---------------------------------------------------------------------------
// Normalized touch helpers — populate the `pp_utm_*` cookie's normalized
// slice directly. All helpers are pure / parameterized so they can be
// composed without instantiating the builder factory.
// ---------------------------------------------------------------------------

/**
 * Normalized + visit-metadata slice of an ExtendedUtmTouch. Kept as its
 * own type so callers that don't care about the literal utm_* slice can
 * pass just this around.
 */
export type NormalizedTouch = {
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

// Click-ID → ad platform map. Order matters within an entry (the first
// matching param wins for clickId extraction); across entries, evaluation
// order matches the data-team's documented precedence.
export const CLICK_ID_PLATFORM_MAP: ReadonlyArray<{ params: string[]; platform: string }> = [
  { params: ['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid'], platform: 'google_ads' },
  { params: ['fbclid'], platform: 'meta_ads' },
  { params: ['ttclid'], platform: 'tiktok_ads' },
  { params: ['msclkid'], platform: 'microsoft_ads' },
  { params: ['li_fat_id'], platform: 'linkedin_ads' },
  { params: ['twclid'], platform: 'twitter_ads' },
  { params: ['epik'], platform: 'pinterest_ads' },
  { params: ['sccid'], platform: 'snapchat_ads' },
];

// Used by `detectPlatform`'s priority-3 referrer-based classification. Kept
// distinct from `SEARCH_ENGINE_PATTERNS` above: that one feeds the 5-step UTM
// resolver (utm_source = engine NAME), while these substrings only need to
// answer "is this an organic search referrer?" for the normalized platform
// field. The two lists agree on the common cases but evolved separately.
export const ORGANIC_SEARCH_DOMAINS: ReadonlyArray<string> = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.'];
export const ORGANIC_SOCIAL_DOMAINS: ReadonlyArray<string> = ['facebook.', 'instagram.', 'twitter.', 'x.com', 'linkedin.', 'tiktok.', 'pinterest.', 'reddit.'];

// Custom param aliases — non-standard query params that map onto the
// canonical UTM dimensions for normalization. E.g. `?source=febpt` populates
// the normalized `source` field even when no `utm_source` is present.
// Critically, aliases do NOT influence platform detection (see buildNormalizedTouch
// — platform comes from known click IDs / utm_source / referrer only).
export const SOURCE_ALIASES: ReadonlyArray<string> = ['source', 'src', 'ref'];
export const MEDIUM_ALIASES: ReadonlyArray<string> = ['medium', 'channel'];
export const CAMPAIGN_ALIASES: ReadonlyArray<string> = ['campaign', 'camp', 'promo'];

/** Marketing-relevant param keys — used by `hasNewTrafficParams` to decide
 *  whether a visit should rotate last-touch attribution regardless of session
 *  state. Includes UTM, every known click ID, and the custom aliases. */
const MARKETING_PARAM_KEYS: ReadonlyArray<string> = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid',
  'msclkid', 'li_fat_id', 'twclid', 'epik', 'sccid',
  ...SOURCE_ALIASES, ...MEDIUM_ALIASES, ...CAMPAIGN_ALIASES,
];

/**
 * Extract sanitized URL params keyed by lowercase name. Sanitization runs
 * through `ppLib.Security.sanitize` (strips known XSS / control sequences).
 * Failures are logged and yield an empty map — callers must treat the result
 * as best-effort.
 */
export function extractParams(
  win: Window & typeof globalThis,
  ppLib: PPLib,
): Record<string, string> {
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

/**
 * Platform inference cascade. Priority:
 *   1. Click ID present → vendor-specific platform (`google_ads`, `meta_ads`, …).
 *   2. `utm_source` mapped to vendor with paid/organic split keyed off
 *      `utm_medium` (cpc/cpm/paid/paid_social/ppc → `_ads` variant).
 *   3. Referrer-based detection: organic_search / organic_social / referral.
 *   4. Fallback: 'direct'.
 *
 * `referrer` is the CLASSIFIED referrer ('direct'/'internal'/'unknown'/host),
 * not a raw URL — see `classifyReferrerForPlatform`.
 */
export function detectPlatform(params: Record<string, string>, referrer: string): string {
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

    if (lower === 'google') return isPaid ? 'google_ads' : 'google';
    if (lower === 'facebook' || lower === 'fb') return isPaid ? 'meta_ads' : 'facebook';
    if (lower === 'instagram' || lower === 'ig') return isPaid ? 'meta_ads' : 'instagram';
    if (lower === 'tiktok') return isPaid ? 'tiktok_ads' : 'tiktok';
    if (lower === 'bing' || lower === 'microsoft') return isPaid ? 'microsoft_ads' : 'bing';
    if (lower === 'linkedin') return isPaid ? 'linkedin_ads' : 'linkedin';
    if (lower === 'twitter' || lower === 'x') return isPaid ? 'twitter_ads' : 'twitter';
    if (lower === 'pinterest') return isPaid ? 'pinterest_ads' : 'pinterest';
    if (lower === 'snapchat') return isPaid ? 'snapchat_ads' : 'snapchat';
    return lower;
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

export function extractClickId(params: Record<string, string>): string {
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
 * The stored TouchAttribution.referrer / ExtendedUtmTouch.referrer field
 * stores the FULL URL (see buildNormalizedTouch); this helper is intentionally
 * separate.
 */
export function classifyReferrerForPlatform(win: Window & typeof globalThis): string {
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
export function stripFragment(href: string): string {
  if (!href) return href;
  const idx = href.indexOf('#');
  return idx === -1 ? href : href.slice(0, idx);
}

/**
 * Denylist of query-string parameter names whose VALUES are likely to carry
 * PII or credentials. Match is case-insensitive against the literal key
 * name. Conservative: better to drop a legitimate UTM-adjacent key by
 * coincidence than to persist an email / phone / token for 2 years in
 * landingPage cookies.
 *
 * Curated for the categories the data-team flagged + common OAuth /
 * auth-link patterns. New entries should land here before they ship to
 * production landing pages.
 */
export const PII_QUERY_PARAM_DENYLIST: ReadonlySet<string> = new Set([
  // Email / phone / contact
  'email', 'e_mail', 'mail', 'emailaddress', 'email_address',
  'phone', 'phone_number', 'phonenumber', 'mobile', 'tel', 'tel_no',
  // Tokens / credentials
  'token', 'access_token', 'id_token', 'refresh_token', 'auth_token',
  'authtoken', 'apikey', 'api_key', 'key', 'secret', 'client_secret',
  'signature', 'sig',
  // Session / auth state
  'password', 'passwd', 'pwd',
  'session', 'session_id', 'sessionid', 'sid', 'jwt',
  // Identity
  'ssn', 'social_security', 'social_security_number',
  'dob', 'date_of_birth', 'birthdate',
  'firstname', 'first_name', 'lastname', 'last_name',
  'fullname', 'full_name', 'name',
  // Patient / pharmacy-specific (PocketPills domain)
  'patientid', 'patient_id', 'patient_email', 'rx', 'rx_number',
  'order_email', 'customer_email',
]);

/**
 * Sanitize a URL for persistence in attribution cookies. Strips:
 *   1. The URL fragment (`#...`) — OAuth implicit-flow access tokens, etc.
 *   2. Query-string parameters whose names match PII_QUERY_PARAM_DENYLIST.
 *
 * Returns the cleaned URL. On any parse failure, falls back to returning
 * the URL up to (but not including) the `?` — preferring data loss over
 * PII persistence. Empty input passes through unchanged.
 *
 * Exported for testability and reuse by any future code path that needs
 * to persist a URL captured from the visitor's session.
 */
export function sanitizeLandingPage(href: string): string {
  if (!href) return href;
  const noFragment = stripFragment(href);
  const qIdx = noFragment.indexOf('?');
  if (qIdx === -1) return noFragment;

  const base = noFragment.slice(0, qIdx);
  const query = noFragment.slice(qIdx + 1);

  try {
    const params = new URLSearchParams(query);
    const filtered = new URLSearchParams();
    params.forEach((value, key) => {
      if (!PII_QUERY_PARAM_DENYLIST.has(key.toLowerCase())) {
        filtered.append(key, value);
      }
    });
    const filteredStr = filtered.toString();
    return filteredStr ? base + '?' + filteredStr : base;
  } catch (e) {
    // Defense-in-depth: an unparseable query is treated as suspect, so
    // we drop it entirely rather than risk persisting PII through a
    // codepath we couldn't validate. Callers get the base URL only.
    return base;
  }
}

/** Extract the hostname from a referrer URL. Returns '' for empty input
 *  or unparseable URLs — never throws. */
export function extractReferrerDomain(referrer: string): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname || '';
  } catch (e) {
    return '';
  }
}

/**
 * Derive a default `medium` value when no `utm_medium` is present, keyed off
 * the detected platform. Mirrors GA4's auto-tagging conventions so funnels
 * stay aligned across tools.
 */
export function inferMedium(params: Record<string, string>, platform: string): string {
  if (params.utm_medium) return params.utm_medium;
  if (platform.endsWith('_ads')) return 'cpc';
  if (platform === 'organic_search') return 'organic';
  if (platform === 'organic_social') return 'social';
  if (platform === 'referral') return 'referral';
  if (platform === 'direct') return 'none';
  return '';
}

/**
 * Resolve a UTM dimension's value from the params map, with primary-then-alias
 * fallback. Used to honour `?source=febpt` / `?channel=email` etc. without
 * conflating them with the literal utm_* slice.
 */
export function resolveParam(params: Record<string, string>, primary: string, aliases: ReadonlyArray<string>): string {
  if (params[primary]) return params[primary];
  for (let i = 0; i < aliases.length; i++) {
    if (params[aliases[i]]) return params[aliases[i]];
  }
  return '';
}

/**
 * Detect whether the current visit carries any marketing-relevant params —
 * UTM keys, click IDs, or custom aliases. Used by captureUtmTouches to
 * decide whether to rotate last-touch regardless of session / self-referral
 * state — a fresh marketing param beats the self-referral veto.
 */
export function hasNewTrafficParams(params: Record<string, string>): boolean {
  for (let i = 0; i < MARKETING_PARAM_KEYS.length; i++) {
    if (params[MARKETING_PARAM_KEYS[i]]) return true;
  }
  return false;
}

/**
 * Build the normalized + visit-metadata slice for the current visit.
 * Same field set as the legacy TouchAttribution shape, same normalization
 * cascade, same fragment-stripping invariant for the landing URL.
 */
export function buildNormalizedTouch(
  win: Window & typeof globalThis,
  params: Record<string, string>,
): NormalizedTouch {
  // Two referrer views: the classifier feeds platform detection (which keys
  // on 'direct'/'internal' and hostname-substring matches), while the stored
  // referrer field is the FULL URL for downstream analytics joins.
  const referrerClass = classifyReferrerForPlatform(win);
  const referrerUrl = (win.document && win.document.referrer) || '';
  const referrerDomain = extractReferrerDomain(referrerUrl);
  const source = resolveParam(params, 'utm_source', SOURCE_ALIASES);
  const medium = resolveParam(params, 'utm_medium', MEDIUM_ALIASES);
  const campaign = resolveParam(params, 'utm_campaign', CAMPAIGN_ALIASES);

  // Detect platform from click IDs, utm_source (NOT custom aliases), or referrer.
  // Custom aliases like ?source=febpt populate the source field but should NOT
  // override platform detection — platform should come from known signals only.
  const platform = detectPlatform(params, referrerClass);

  return {
    source: source || (platform !== 'direct' ? platform.replace('_ads', '').replace('_', '') : 'direct'),
    medium: medium || inferMedium(params, platform),
    campaign: campaign,
    platform: platform,
    clickId: extractClickId(params),
    // landingPage: full URL with query string, fragment stripped AND known
    // PII / credential query params dropped. Without sanitisation a landing
    // page that accepts `?email=`, `?token=`, etc. would persist user PII
    // in the cookie for up to 2 years (first-touch horizon). UTM / click-ID
    // params survive — they're explicitly marketing data, not PII.
    landingPage: sanitizeLandingPage((win.location && win.location.href) || '/'),
    referrer: referrerUrl,
    referrerDomain: referrerDomain,
    timestamp: new Date().toISOString(),
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
    if (normalizedFirstEver || hasNewParams || (!sessionActive && !selfReferral && !currentHasNoSignal)) {
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
      persistExtended(UTM_FIRST_TOUCH_KEY, {
        utm_source: literalSliceEmpty ? resolvedLastExt.utm_source : existingFirstExt.utm_source,
        utm_medium: literalSliceEmpty ? resolvedLastExt.utm_medium : existingFirstExt.utm_medium,
        utm_campaign: literalSliceEmpty ? resolvedLastExt.utm_campaign : existingFirstExt.utm_campaign,
        utm_content: literalSliceEmpty ? resolvedLastExt.utm_content : existingFirstExt.utm_content,
        utm_term: literalSliceEmpty ? resolvedLastExt.utm_term : existingFirstExt.utm_term,
        source: normalizedSliceEmpty ? resolvedLastExt.source : existingFirstExt.source,
        medium: normalizedSliceEmpty ? resolvedLastExt.medium : existingFirstExt.medium,
        campaign: normalizedSliceEmpty ? resolvedLastExt.campaign : existingFirstExt.campaign,
        platform: normalizedSliceEmpty ? resolvedLastExt.platform : existingFirstExt.platform,
        clickId: normalizedSliceEmpty ? resolvedLastExt.clickId : existingFirstExt.clickId,
        referrer: normalizedSliceEmpty ? resolvedLastExt.referrer : existingFirstExt.referrer,
        referrerDomain: normalizedSliceEmpty ? resolvedLastExt.referrerDomain : existingFirstExt.referrerDomain,
        landingPage: normalizedSliceEmpty ? resolvedLastExt.landingPage : existingFirstExt.landingPage,
        timestamp: normalizedSliceEmpty ? resolvedLastExt.timestamp : existingFirstExt.timestamp,
        // First-touch never participates in session-veto rotation (the cookie
        // is locked by per-slice immutability above), so sessionTs is
        // persisted as 0 — schema-uniform but semantically inert.
        sessionTs: 0,
      });
    }

    // Session anchor for last-touch rotation is now inlined as `sessionTs`
    // on the resolvedLastExt persisted above — no separate cookie to touch.
  }

  /**
   * Build the `marketing_attribution` super-property / event-property value
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
    if (touch[key]) return touch[key];
    return key === 'utm_content' || key === 'utm_term' ? 'none' : '$direct';
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

    // Literal utm_* params — intentionally NOT routed through the normalized
    // resolver, so e.g. `?source=febpt` does NOT populate utm_source. The
    // normalized slice of the same extended cookie carries the alias-resolved
    // view for marketing_attribution / referrer / landing_page bracket props.
    const currentUtm = readUtmFromUrl();
    const firstExt = readStoredExtended(UTM_FIRST_TOUCH_KEY);
    const lastExt = readStoredExtended(UTM_LAST_TOUCH_KEY);
    const firstUtm = projectToRaw(firstExt);
    const lastUtm = projectToRaw(lastExt);

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
    getLastTouchUtm: getLastTouchUtm,
    getMarketingAttribution: getMarketingAttribution,
  };
}
