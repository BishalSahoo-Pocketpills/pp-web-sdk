/**
 * Voucherify segment resolution.
 *
 * Maps a visitor's URL params + cookies + member state to a single
 * segment key, which keys both pricing and offers KV reads on the edge
 * worker side. Priority order (highest to lowest):
 *
 *   1. `?vseg=<segment>` — explicit override, sanitized + persisted.
 *   2. Configured `CONFIG.segments.rules` — `(param, value)` pairs that
 *      map to a configured segment key.
 *   3. Ad-platform click IDs (gclid, fbclid, ttclid, etc.) → `ad_source:*`.
 *   4. Persisted `pp_segment` cookie from a prior visit.
 *   5. `customerSourceIdCookie` presence → `'member'` (or 'anonymous').
 *
 * `prioritizeOverMember: true` flips 5 to come AFTER 1–4 so a marketing
 * campaign can override a returning member's segment for the session.
 *
 * Extracted from voucherify/index.ts so the resolution rules can be
 * tested without spinning up the full pricing engine, and so future
 * segment sources (geolocation, A/B test variants) can plug in here
 * without bloating the SDK entry file.
 */

import type { PPLib } from '@src/types/common.types';
import type { VoucherifyConfig } from '@src/types/voucherify.types';

interface ClickIdMapping {
  param: string;
  segment: string;
  source: string;
}

// Ad-platform click IDs are industry-standard URL params, not customer-
// configurable. If a platform changes its param name, the list here is
// the single place to update.
const CLICK_ID_MAP: ReadonlyArray<ClickIdMapping> = [
  { param: 'gclid', segment: 'ad_source:google', source: 'google' },
  { param: 'fbclid', segment: 'ad_source:facebook', source: 'facebook' },
  { param: 'ttclid', segment: 'ad_source:tiktok', source: 'tiktok' },
  { param: 'msclkid', segment: 'ad_source:bing', source: 'bing' },
  { param: 'li_fat_id', segment: 'ad_source:linkedin', source: 'linkedin' },
  { param: 'epik', segment: 'ad_source:pinterest', source: 'pinterest' },
];

const SEGMENT_AD_SOURCE_PREFIX = 'ad_source:';
const SEGMENT_INSTAGRAM = SEGMENT_AD_SOURCE_PREFIX + 'instagram';
const SEGMENT_MEMBER = 'member';
const SEGMENT_ANONYMOUS = 'anonymous';
const EXPLICIT_SEGMENT_PARAM = 'vseg';

export interface SegmentResolver {
  determineSegment: () => string;
  /** Visible-for-tests resolver that returns just the URL-driven result. */
  resolveSegmentFromRules: () => string | null;
}

export function createSegmentResolver(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig,
): SegmentResolver {
  function detectAdSourceFromClickId(params: URLSearchParams): string | null {
    for (let i = 0; i < CLICK_ID_MAP.length; i++) {
      if (params.has(CLICK_ID_MAP[i].param)) {
        // Special case: fbclid is shared by Facebook and Instagram. Use
        // utm_source to disambiguate when available.
        if (CLICK_ID_MAP[i].param === 'fbclid') {
          const utmSrc = (params.get('utm_source') || '').toLowerCase().trim();
          if (utmSrc === 'instagram') return SEGMENT_INSTAGRAM;
        }
        return CLICK_ID_MAP[i].segment;
      }
    }

    // Fallback: utm_source maps to ad_source:{value} for any platform,
    // known or otherwise (allows new platforms to land segments without
    // a code change).
    const utmSource = params.get('utm_source');
    if (utmSource) {
      const normalized = utmSource.toLowerCase().trim();
      for (let j = 0; j < CLICK_ID_MAP.length; j++) {
        if (CLICK_ID_MAP[j].source === normalized) {
          return CLICK_ID_MAP[j].segment;
        }
      }
      if (normalized) {
        return SEGMENT_AD_SOURCE_PREFIX + ppLib.Security.sanitize(normalized);
      }
    }

    return null;
  }

  function persistSegmentCookie(segment: string): void {
    const maxAge = CONFIG.segments.cookieMaxAgeMinutes * 60;
    doc.cookie =
      CONFIG.segments.cookieName +
      '=' +
      encodeURIComponent(segment) +
      ';path=/;max-age=' +
      maxAge +
      ';SameSite=Lax';
  }

  function resolveSegmentFromRules(): string | null {
    const params = new URLSearchParams(win.location.search);

    // Priority 1: Explicit segment param (e.g., ?vseg=ad_source:google).
    const explicitSeg = params.get(EXPLICIT_SEGMENT_PARAM);
    if (explicitSeg) {
      const sanitized = ppLib.Security.sanitize(explicitSeg);
      if (sanitized) {
        persistSegmentCookie(sanitized);
        return sanitized;
      }
    }

    // Priority 2: Configurable rules (param + value → segment).
    const rules = CONFIG.segments.rules;
    if (rules && rules.length > 0) {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const paramValue = params.get(rule.param);
        if (paramValue === rule.value) {
          persistSegmentCookie(rule.segment);
          return rule.segment;
        }
      }
    }

    // Priority 3: Ad-platform click IDs.
    const adSegment = detectAdSourceFromClickId(params);
    if (adSegment) {
      persistSegmentCookie(adSegment);
      return adSegment;
    }

    // Priority 4: Persisted cookie from a prior visit. getCookie already
    // decodes; sanitize for defense-in-depth (cookie can be tampered).
    const cookieVal = ppLib.getCookie(CONFIG.segments.cookieName);
    if (cookieVal) return ppLib.Security.sanitize(cookieVal);

    return null;
  }

  function determineSegment(): string {
    if (CONFIG.segments.prioritizeOverMember) {
      const ruleSegment = resolveSegmentFromRules();
      if (ruleSegment) return ruleSegment;
      const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
      if (sourceId) return SEGMENT_MEMBER;
      return SEGMENT_ANONYMOUS;
    }

    // Default: a known member takes priority over a rule-resolved segment.
    const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (sourceId) return SEGMENT_MEMBER;
    const ruleSegment = resolveSegmentFromRules();
    if (ruleSegment) return ruleSegment;
    return SEGMENT_ANONYMOUS;
  }

  return {
    determineSegment,
    resolveSegmentFromRules,
  };
}
