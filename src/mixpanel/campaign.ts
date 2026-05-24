/**
 * Campaign / UTM attribution helpers — register `utm_* [first touch]` and
 * `utm_* [last touch]` super-props plus click-IDs (gclid, fbclid). Now
 * dispatch-driven so both instances get identical attribution super-props.
 *
 * Per the Analytics UTM events spec, utm_source / utm_medium / utm_campaign
 * default to '$direct' when no value is set; utm_content and utm_term
 * default to 'none' (so consumers can distinguish "direct traffic with no
 * creative/keyword context" from "creative/keyword genuinely absent").
 * Applied uniformly across [first touch] / [last touch] / session-reset so
 * direct visits produce stable, queryable values rather than empty strings
 * or missing keys.
 *
 * The shared event-properties builder tracks LITERAL `utm_*` URL params
 * (no normalization), so traffic that uses non-utm aliases like
 * `?source=febpt` does not pollute these super-properties. The attribution
 * service's normalized values still flow separately into the
 * `marketingAttribution` super-property.
 */
import type { PPLib } from '@src/types/common.types';
import { dispatch } from '@src/mixpanel/dispatch';

let pp: PPLib | null = null;

export function configureCampaign(ppLib: PPLib): void {
  pp = ppLib;
}

export function resetCampaign(): void {
  pp = null;
}

const CAMPAIGN_KEYWORDS = 'utm_source utm_medium utm_campaign utm_content utm_term'.split(' ');

type UtmTouch = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
};

function emptyUtmTouch(): UtmTouch {
  return { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };
}

function fallbackForKeyword(keyword: string): string {
  return keyword === 'utm_content' || keyword === 'utm_term' ? 'none' : '$direct';
}

function buildTouchParams(
  touch: UtmTouch,
  suffix: '[first touch]' | '[last touch]',
): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
    const kw = CAMPAIGN_KEYWORDS[i] as keyof UtmTouch;
    params[kw + ' ' + suffix] = touch[kw] || fallbackForKeyword(kw);
  }
  return params;
}

/**
 * Session-boundary reset — clear last-touch attribution to canonical
 * defaults. Called from the SessionManager when a new session is minted.
 */
export function resetSessionCampaign(): void {
  const params = buildTouchParams(emptyUtmTouch(), '[last touch]');
  dispatch('people.set', [params]);
  dispatch('register', [params]);
}

/**
 * Boot-time UTM registration. Reads first/last touch from the shared
 * event-properties builder (falls back to direct extraction if absent —
 * defensive; common module always installs the builder), attaches click
 * IDs from the current URL, and registers on every enabled instance.
 *
 * First-touch keys use `set_once` / `register_once` so a re-init after
 * cookie clearing cannot overwrite first-touch values already on a profile.
 */
export function registerCampaignParams(doc: Document): void {
  if (!pp) return;
  const builder = pp.eventPropertiesBuilder;
  const firstTouch: UtmTouch = builder
    ? (builder.getFirstTouchUtm() as UtmTouch)
    : emptyUtmTouch();
  const lastTouch: UtmTouch = builder
    ? (builder.getLastTouchUtm() as UtmTouch)
    : emptyUtmTouch();

  const lastParams = buildTouchParams(lastTouch, '[last touch]');
  const firstParams = buildTouchParams(firstTouch, '[first touch]');

  const url = doc.URL;
  const gclid = pp.getQueryParam(url, 'gclid');
  /*! v8 ignore start */
  if (gclid.length) {
  /*! v8 ignore stop */
    lastParams['gclid'] = gclid;
  }

  const fbclid = pp.getQueryParam(url, 'fbclid');
  /*! v8 ignore start */
  if (fbclid.length) {
  /*! v8 ignore stop */
    lastParams['fbclid'] = fbclid;
  }

  dispatch('people.set', [lastParams]);
  dispatch('register', [lastParams]);
  dispatch('people.set_once', [firstParams]);
  dispatch('register_once', [firstParams]);
}
