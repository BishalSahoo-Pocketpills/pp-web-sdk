/**
 * UTM Types & Helpers
 *
 * Core UTM data-structure types, constants, and serialization helpers used by
 * the event-properties builder and the attribution module. Split out so both
 * can import the shared vocabulary without a circular dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UTM_KEYS: ReadonlyArray<keyof RawUtmTouch> = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Keys of the normalized + visit-metadata slices of `ExtendedUtmTouch`.
// Centralised so parseUtmTouch / emptyExtended / projection helpers stay
// in lockstep when the schema grows.
export const EXTENDED_TOUCH_EXTRA_KEYS: ReadonlyArray<keyof ExtendedUtmTouch> = [
  'source', 'medium', 'campaign', 'platform', 'clickId',
  'referrer', 'referrerDomain', 'landingPage', 'timestamp',
];

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function emptyUtm(): RawUtmTouch {
  return { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };
}

export function emptyExtended(): ExtendedUtmTouch {
  return {
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    source: '', medium: '', campaign: '', platform: '', clickId: '',
    referrer: '', referrerDomain: '', landingPage: '', timestamp: '',
    sessionTs: 0,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

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
export function parseUtmTouch(raw: string): ExtendedUtmTouch | null {
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
