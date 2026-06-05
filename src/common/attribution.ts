/**
 * Attribution Helpers
 *
 * Pure, stateless functions for marketing-attribution classification:
 * search-engine detection, root-domain extraction, click-ID mapping,
 * platform inference, referrer classification, PII sanitization, and
 * normalized-touch construction.
 *
 * All functions are exported individually and are consumed by the
 * event-properties builder's `captureUtmTouches` / `build` path.
 */
import type { PPLib } from '@src/types/common.types';
import type { NormalizedTouch } from '@src/common/utm-types';

// ---------------------------------------------------------------------------
// Search-engine patterns
// ---------------------------------------------------------------------------

// Search-engine names — matched against the referrer hostname using a
// "dot or start of segment, then engine token, then dot" pattern so we hit
// regional TLDs (`google.co.uk`, `bing.co.in`) and subdomains
// (`images.google.com`) but NOT bogus collisions like `googleads.example.com`
// (their token isn't followed by a dot leading into the TLD). The token
// list mirrors the attribution service's ORGANIC_SEARCH_DOMAINS plus a few
// more (ecosia / brave) commonly cited in the data team's prior reports.
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

// ---------------------------------------------------------------------------
// Root-domain extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Click-ID / platform detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Param extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Click-ID extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Referrer classification
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// URL sanitization
// ---------------------------------------------------------------------------

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
  // One-time passcodes / 2FA / MFA (magic-link + verification flows)
  'otp', 'totp', 'one_time_password', 'onetime_password', 'one_time_code',
  'passcode', 'pass_code', 'verification_code', 'verify_code', 'auth_code',
  'confirmation_code', 'confirm_code', '2fa', 'mfa',
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

// ---------------------------------------------------------------------------
// Referrer domain extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Medium inference
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Param resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Traffic-param detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Normalized touch builder
// ---------------------------------------------------------------------------

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
    landingPage: sanitizeLandingPage((win.location && win.location.href) || '/'),
    referrer: referrerUrl,
    referrerDomain: referrerDomain,
    timestamp: new Date().toISOString(),
  };
}
