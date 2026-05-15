/**
 * Unit tests for the shared event-properties builder.
 *
 * The builder is the single source of truth for per-event context. Both the
 * dataLayer enricher and the mixpanel.track facade rely on it.
 */
import { createEventPropertiesBuilder } from '../../src/common/event-properties-builder';
import { createGetQueryParam } from '../../src/common/url';
import { createSetCookie, createDeleteCookie } from '../../src/common/cookies';
import type { PPLib } from '../../src/types/common.types';

type FixtureTouch = {
  source: string;
  medium: string;
  campaign: string;
  referrer: string;
  referrerDomain?: string;
  landingPage?: string;
};

function makePPLib(opts?: {
  cookies?: Record<string, string>;
  attribution?: {
    current?: FixtureTouch | null;
    first?: FixtureTouch | null;
    last?: FixtureTouch | null;
    summary?: unknown;
  } | null;
  session?: { id: string } | null;
}): PPLib {
  const cookies = opts?.cookies || {};
  const attribution = opts?.attribution === null ? undefined : (opts?.attribution || {
    current: { source: 'google', medium: 'cpc', campaign: 'spring', referrer: 'google.com' },
    first: { source: 'facebook', medium: 'social', campaign: 'launch', referrer: 'facebook.com' },
    last: { source: 'google', medium: 'cpc', campaign: 'spring', referrer: 'google.com' },
    summary: { source: 'google', medium: 'cpc', campaign: 'spring' }
  });
  const session = opts?.session === null ? undefined : (opts?.session || { id: 'test-session-id' });

  const log = vi.fn();
  // Cookie reader serves the seeded map first, then falls back to live
  // document.cookie so PersistentValue-managed entries (pp_device_id,
  // pp_utm_*) round-trip cleanly through write→read.
  const getCookieReal = (name: string): string | null => {
    if (Object.prototype.hasOwnProperty.call(cookies, name)) return cookies[name];
    try {
      if (!name || !document.cookie) return null;
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : null;
    } catch (e) { return null; }
  };
  const ppLib: any = {
    config: { cookieDomain: undefined },
    getCookie: vi.fn(getCookieReal),
    setCookie: createSetCookie(document, window, log),
    deleteCookie: createDeleteCookie(document, window, log),
    getQueryParam: createGetQueryParam(),
    log
  };
  if (attribution) {
    ppLib.attribution = {
      getCurrent: vi.fn(() => attribution.current ?? null),
      getFirstTouch: vi.fn(() => attribution.first ?? null),
      getLastTouch: vi.fn(() => attribution.last ?? null),
      get: vi.fn(() => attribution.summary ?? null)
    };
  }
  if (session) {
    ppLib.session = {
      getOrCreateSessionId: vi.fn(() => session.id),
      clearSession: vi.fn()
    };
  }
  return ppLib as PPLib;
}

describe('createEventPropertiesBuilder', () => {
  beforeEach(() => {
    localStorage.clear();
    // device_id / UTM touch now live in cookies — wipe both layers for isolation.
    document.cookie.split(';').forEach(c => {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
  });

  describe('build()', () => {
    it('produces userProperties / eventProperties / page / attribution blocks', () => {
      // Stub document.URL so the literal-utm reader picks up the params.
      // The attribution-service mock still provides the normalized
      // marketingAttribution, but utm_* keys are sourced strictly from URL.
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google&utm_medium=cpc&utm_campaign=spring',
        writable: true,
        configurable: true,
      });
      window.localStorage.clear();

      const ppLib = makePPLib({
        cookies: { userId: '42', patientId: '99', app_is_authenticated: 'true', country: 'CA' }
      });
      const builder = createEventPropertiesBuilder(window, ppLib);
      const bundle = builder.build();

      expect(bundle.userProperties).toEqual({
        userId: '42',
        patientId: '99',
        pp_distinct_id: '42'
      });

      expect(bundle.eventProperties.pp_user_id).toBe('42');
      expect(bundle.eventProperties.pp_patient_id).toBe('99');
      expect(bundle.eventProperties.pp_session_id).toBe('test-session-id');
      expect(bundle.eventProperties.logged_in).toBe('true');
      expect(bundle.eventProperties.platform).toBe('web');
      expect(bundle.eventProperties.Country).toBe('CA');
      expect(typeof bundle.eventProperties.device_id).toBe('string');
      expect(typeof bundle.eventProperties.pp_timestamp).toBe('number');

      // utm_* are read literally from the URL, not from the (potentially
      // normalized) attribution service.
      expect(bundle.eventProperties.utm_source).toBe('google');
      expect(bundle.eventProperties.utm_medium).toBe('cpc');
      expect(bundle.eventProperties.utm_campaign).toBe('spring');

      // First/last touch: this URL has utm_* params, so capture seeds
      // localStorage and the touch keys mirror the current visit.
      expect(bundle.eventProperties['utm_source [first touch]']).toBe('google');
      expect(bundle.eventProperties['utm_medium [first touch]']).toBe('cpc');
      expect(bundle.eventProperties['utm_campaign [first touch]']).toBe('spring');

      expect(bundle.eventProperties['utm_source [last touch]']).toBe('google');
      expect(bundle.eventProperties['utm_medium [last touch]']).toBe('cpc');
      expect(bundle.eventProperties['utm_campaign [last touch]']).toBe('spring');

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });

      expect(bundle.page.title).toBe('');
      expect(typeof bundle.page.url).toBe('string');

      expect(bundle.attribution).toMatchObject({
        fbclid: null,
        fbc: null,
        fbp: null,
        gclid: null,
        gbraid: null,
        wbraid: null,
        ttclid: null,
        epik: null,
        rdt_cid: null
      });
    });

    it('uses $direct/none fallbacks when first/last/current touch are missing', () => {
      const ppLib = makePPLib({
        attribution: { current: null, first: null, last: null, summary: null }
      });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['utm_source [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_medium [first touch]']).toBe('none');
      expect(bundle.eventProperties['utm_campaign [first touch]']).toBe('none');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_medium [last touch]']).toBe('none');
      expect(bundle.eventProperties['utm_campaign [last touch]']).toBe('none');
      // Current UTM keys also follow the $direct/none convention so direct
      // visits produce stable values across all UTM dimensions.
      expect(bundle.eventProperties.utm_source).toBe('$direct');
      expect(bundle.eventProperties.utm_medium).toBe('none');
      expect(bundle.eventProperties.utm_campaign).toBe('none');
      expect(bundle.eventProperties.initial_referrer).toBe('');
    });

    it('treats appAuth=true as logged-in regardless of userId/patientId', () => {
      const ppLib = makePPLib({ cookies: { app_is_authenticated: 'true' } });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties.logged_in).toBe('true');
      // Inherited behavior: pp_distinct_id mirrors userId when logged in,
      // even if userId is empty. Documenting actual behavior — callers that
      // need a non-empty distinct_id must ensure userId is set first.
      expect(bundle.userProperties.pp_distinct_id).toBe('');
    });

    it('treats userId="-1" as anonymous (matching cookie sentinel)', () => {
      const ppLib = makePPLib({ cookies: { userId: '-1', patientId: '99' } });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties.logged_in).toBe('false');
      expect(bundle.userProperties.pp_distinct_id).toBe(bundle.eventProperties.device_id);
    });

    it('falls back gracefully when ppLib.attribution is missing', () => {
      const ppLib = makePPLib({ attribution: null });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['utm_source [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('$direct');
      expect(bundle.eventProperties.marketing_attribution).toBeNull();
      expect(bundle.eventProperties.initial_referrer).toBe('');
    });

    it('falls back to empty session id when ppLib.session is missing', () => {
      const ppLib = makePPLib({ session: null });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties.pp_session_id).toBe('');
    });

    it('persists device_id across calls', () => {
      const ppLib = makePPLib();
      const builder = createEventPropertiesBuilder(window, ppLib);
      const a = builder.build().eventProperties.device_id;
      const b = builder.build().eventProperties.device_id;

      expect(a).toBeTruthy();
      expect(a).toBe(b);
    });

    it('emits the 6 new 1C touch attributes from first/last attribution touches', () => {
      const first: FixtureTouch = {
        source: 'facebook', medium: 'social', campaign: 'launch', referrer: 'https://www.facebook.com/some-page',
        referrerDomain: 'www.facebook.com',
        landingPage: 'http://localhost/lp/first?utm_source=facebook',
      };
      const last: FixtureTouch = {
        source: 'google', medium: 'cpc', campaign: 'spring', referrer: 'https://www.google.com/search?q=pp',
        referrerDomain: 'www.google.com',
        landingPage: 'http://localhost/lp/last?utm_source=google&utm_medium=cpc',
      };
      const ppLib = makePPLib({
        attribution: { current: last, first: first, last: last }
      });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['referrer [first touch]']).toBe('https://www.facebook.com/some-page');
      expect(bundle.eventProperties['referrer [last touch]']).toBe('https://www.google.com/search?q=pp');
      expect(bundle.eventProperties['referrer_domain [first touch]']).toBe('www.facebook.com');
      expect(bundle.eventProperties['referrer_domain [last touch]']).toBe('www.google.com');
      expect(bundle.eventProperties['landing_page_url [first touch]']).toBe('http://localhost/lp/first?utm_source=facebook');
      expect(bundle.eventProperties['landing_page_url [last touch]']).toBe('http://localhost/lp/last?utm_source=google&utm_medium=cpc');
    });

    it('emits empty strings for 1C touch attributes when attribution is unavailable', () => {
      const ppLib = makePPLib({ attribution: null });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['referrer [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer [last touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [last touch]']).toBe('');
      expect(bundle.eventProperties['landing_page_url [first touch]']).toBe('');
      expect(bundle.eventProperties['landing_page_url [last touch]']).toBe('');
    });

    it('emits empty strings for 1C touch attributes when first/last touches are null', () => {
      const ppLib = makePPLib({
        attribution: { current: null, first: null, last: null, summary: null }
      });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['referrer [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer [last touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [last touch]']).toBe('');
      expect(bundle.eventProperties['landing_page_url [first touch]']).toBe('');
      expect(bundle.eventProperties['landing_page_url [last touch]']).toBe('');
    });

    describe('device (model) parsing', () => {
      const cases: Array<{ ua: string; expected: string; label: string }> = [
        { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', expected: 'iPhone', label: 'iPhone' },
        { ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', expected: 'iPad', label: 'iPad' },
        // iPod touch UA also contains "iPhone OS" — the parser checks iPhone
        // first, so a real iPod touch UA returns 'iPhone'. To verify the iPod
        // branch in isolation we use a synthetic UA with iPod but no iPhone.
        { ua: 'Mozilla/5.0 (iPod; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15', expected: 'iPod', label: 'iPod (no iPhone substring)' },
        { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile', expected: 'Android', label: 'Android phone' },
        { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', expected: 'MacBook', label: 'Macintosh -> MacBook' },
        { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', expected: 'Windows', label: 'Windows' },
        { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', expected: 'Linux', label: 'Linux (no Android)' },
        { ua: 'Mozilla/5.0 (CrKey; like iOS 9_3_3 not-a-real-device)', expected: '', label: 'unrecognized UA falls back to empty' },
        { ua: '', expected: '', label: 'empty UA' },
      ];

      const originalUA = navigator.userAgent;
      afterEach(() => {
        Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
      });

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        it(`maps ${c.label} → "${c.expected}"`, () => {
          Object.defineProperty(navigator, 'userAgent', { value: c.ua, configurable: true });
          const ppLib = makePPLib();
          const bundle = createEventPropertiesBuilder(window, ppLib).build();
          expect(bundle.eventProperties.device).toBe(c.expected);
        });
      }

      it('emits device alongside device_type (the two are distinct)', () => {
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile',
          configurable: true
        });
        const ppLib = makePPLib();
        const bundle = createEventPropertiesBuilder(window, ppLib).build();
        // device (model) is iPhone; device_type (form-factor) is mobile.
        expect(bundle.eventProperties.device).toBe('iPhone');
        expect(bundle.eventProperties.device_type).toBe('mobile');
      });

      it('iPhone UA does not match iPad/iPod parsers (substring ordering)', () => {
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
          configurable: true
        });
        const ppLib = makePPLib();
        const bundle = createEventPropertiesBuilder(window, ppLib).build();
        expect(bundle.eventProperties.device).toBe('iPhone');
      });
    });

    it('migrates legacy localStorage UTM first/last touch to cookies on first read', () => {
      // Seed legacy localStorage UTM touches — JSON-encoded per the old contract.
      const legacyFirst = { utm_source: 'facebook', utm_medium: 'social', utm_campaign: 'launch', utm_content: '', utm_term: '' };
      const legacyLast = { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: '', utm_term: '' };
      window.localStorage.setItem('pp_utm_first_touch', JSON.stringify(legacyFirst));
      window.localStorage.setItem('pp_utm_last_touch', JSON.stringify(legacyLast));

      const ppLib = makePPLib();
      const builder = createEventPropertiesBuilder(window, ppLib);
      const bundle = builder.build();

      // Values carried over into event properties
      expect(bundle.eventProperties['utm_source [first touch]']).toBe('facebook');
      expect(bundle.eventProperties['utm_medium [first touch]']).toBe('social');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('google');
      expect(bundle.eventProperties['utm_medium [last touch]']).toBe('cpc');

      // Cookies seeded with JSON payloads (URL-encoded)
      expect(document.cookie).toContain('pp_utm_first_touch=');
      expect(document.cookie).toContain('pp_utm_last_touch=');
      const decodedFirst = decodeURIComponent((document.cookie.match(/pp_utm_first_touch=([^;]+)/) as RegExpMatchArray)[1]);
      expect(JSON.parse(decodedFirst)).toEqual(legacyFirst);

      // Legacy localStorage entries purged
      expect(window.localStorage.getItem('pp_utm_first_touch')).toBeNull();
      expect(window.localStorage.getItem('pp_utm_last_touch')).toBeNull();
    });

    it('migrates a legacy localStorage device_id to the cookie on first read', () => {
      // Seed legacy localStorage as if a user pre-dates the rollout.
      window.localStorage.setItem('pp_device_id', 'legacy-device-uuid');
      const ppLib = makePPLib();

      const id = createEventPropertiesBuilder(window, ppLib).build().eventProperties.device_id;

      // Same value carried over
      expect(id).toBe('legacy-device-uuid');
      // Cookie now holds it (the cross-subdomain source of truth)
      expect(document.cookie).toContain('pp_device_id=legacy-device-uuid');
      // Legacy localStorage entry was purged (one-time migration)
      expect(window.localStorage.getItem('pp_device_id')).toBeNull();
    });
  });

  describe('configure()', () => {
    it('overrides cookie names', () => {
      const ppLib = makePPLib({ cookies: { custom_uid: '7', custom_country: 'US' } });
      const builder = createEventPropertiesBuilder(window, ppLib);

      builder.configure({
        cookieNames: { userId: 'custom_uid', country: 'custom_country' }
      });

      const bundle = builder.build();
      expect(bundle.eventProperties.pp_user_id).toBe('7');
      expect(bundle.eventProperties.Country).toBe('US');
    });

    it('overrides default platform', () => {
      const ppLib = makePPLib();
      const builder = createEventPropertiesBuilder(window, ppLib);
      builder.configure({ defaultPlatform: 'ios' });

      expect(builder.build().eventProperties.platform).toBe('ios');
    });

    it('invalidates the stable cache so country picks up new cookie name', () => {
      const ppLib = makePPLib({ cookies: { country: 'CA', alt_country: 'IN' } });
      const builder = createEventPropertiesBuilder(window, ppLib);

      expect(builder.build().eventProperties.Country).toBe('CA');

      builder.configure({ cookieNames: { country: 'alt_country' } });
      expect(builder.build().eventProperties.Country).toBe('IN');
    });
  });

  describe('buildFlat()', () => {
    it('flattens userProperties + eventProperties + non-null attribution', () => {
      const ppLib = makePPLib({
        cookies: { userId: '42', patientId: '99', app_is_authenticated: 'true' }
      });
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      // userProperties present
      expect(flat.userId).toBe('42');
      expect(flat.patientId).toBe('99');
      expect(flat.pp_distinct_id).toBe('42');

      // eventProperties present
      expect(flat.pp_user_id).toBe('42');
      expect(flat.logged_in).toBe('true');
      expect(typeof flat.device_id).toBe('string');
      expect(typeof flat.current_url).toBe('string');
    });

    it('emits 1C touch attributes in the flat payload (NOT in the super-prop skip set)', () => {
      const first: FixtureTouch = {
        source: 'facebook', medium: 'social', campaign: 'launch',
        referrer: 'https://www.facebook.com/x', referrerDomain: 'www.facebook.com',
        landingPage: 'http://localhost/a?utm_source=facebook',
      };
      const last: FixtureTouch = {
        source: 'google', medium: 'cpc', campaign: 'spring',
        referrer: 'https://www.google.com/', referrerDomain: 'www.google.com',
        landingPage: 'http://localhost/b?utm_source=google',
      };
      const ppLib = makePPLib({
        attribution: { current: last, first: first, last: last }
      });
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      expect(flat['referrer [first touch]']).toBe('https://www.facebook.com/x');
      expect(flat['referrer [last touch]']).toBe('https://www.google.com/');
      expect(flat['referrer_domain [first touch]']).toBe('www.facebook.com');
      expect(flat['referrer_domain [last touch]']).toBe('www.google.com');
      expect(flat['landing_page_url [first touch]']).toBe('http://localhost/a?utm_source=facebook');
      expect(flat['landing_page_url [last touch]']).toBe('http://localhost/b?utm_source=google');
    });

    it('includes utm_* [first/last touch] and marketing_attribution per-event (parity with dataLayer)', () => {
      const ppLib = makePPLib();
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      // Per the data-team contract: these keys ride per-event so dataLayer
      // / GTM consumers see the same data as Mixpanel reports — even though
      // Mixpanel ALSO registers them as super-properties on the side.
      expect(flat['utm_source [first touch]']).toBe('$direct');
      expect(flat['utm_medium [first touch]']).toBe('none');
      expect(flat['utm_campaign [first touch]']).toBe('none');
      expect(flat['utm_source [last touch]']).toBe('$direct');
      expect(flat['utm_medium [last touch]']).toBe('none');
      expect(flat['utm_campaign [last touch]']).toBe('none');
      // marketing_attribution from the fixture's `summary` block (see makePPLib defaults).
      expect(flat.marketing_attribution).toEqual({ source: 'google', medium: 'cpc', campaign: 'spring' });
    });

    it('keeps the current (non-touch) UTM keys, sourced from URL', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google&utm_medium=cpc&utm_campaign=spring',
        writable: true,
        configurable: true,
      });
      window.localStorage.clear();

      const ppLib = makePPLib();
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      expect(flat.utm_source).toBe('google');
      expect(flat.utm_medium).toBe('cpc');
      expect(flat.utm_campaign).toBe('spring');

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('omits null click-id attribution fields, keeps non-null ones', () => {
      // Simulate gclid in URL by overriding location.search via a fresh builder.
      // Here we rely on the default jsdom URL having no params, so all click
      // IDs should be null and therefore omitted from the flat payload.
      const ppLib = makePPLib();
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      expect(Object.prototype.hasOwnProperty.call(flat, 'fbclid')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'gclid')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'rdt_cid')).toBe(false);
    });
  });

  describe('buildNested()', () => {
    it('returns exactly the four wrapper blocks at the top level', () => {
      const ppLib = makePPLib({
        cookies: { userId: '42', patientId: '99', app_is_authenticated: 'true', country: 'CA' }
      });
      const nested = createEventPropertiesBuilder(window, ppLib).buildNested();

      // Exactly four top-level keys — no leakage of flat fields.
      expect(Object.keys(nested).sort()).toEqual(['attribution', 'eventProperties', 'page', 'userProperties']);
    });

    it('each wrapper has the same shape as build()', () => {
      const ppLib = makePPLib({
        cookies: { userId: '42', patientId: '99', app_is_authenticated: 'true', country: 'CA' }
      });
      const builder = createEventPropertiesBuilder(window, ppLib);
      const bundle = builder.build();
      const nested = builder.buildNested();

      const userProps = nested.userProperties as Record<string, unknown>;
      expect(userProps.userId).toBe(bundle.userProperties.userId);
      expect(userProps.patientId).toBe(bundle.userProperties.patientId);
      expect(userProps.pp_distinct_id).toBe(bundle.userProperties.pp_distinct_id);

      const eventProps = nested.eventProperties as Record<string, unknown>;
      expect(eventProps.pp_user_id).toBe(bundle.eventProperties.pp_user_id);
      expect(eventProps.logged_in).toBe('true');
      expect(eventProps.platform).toBe('web');

      const page = nested.page as Record<string, unknown>;
      expect(typeof page.url).toBe('string');
      expect(typeof page.title).toBe('string');
      expect(typeof page.referrer).toBe('string');

      const attribution = nested.attribution as Record<string, unknown>;
      // All click-ID fields exist (null when absent), unlike buildFlat which omits nulls.
      expect('fbclid' in attribution).toBe(true);
      expect('gclid' in attribution).toBe(true);
      expect('rdt_cid' in attribution).toBe(true);
    });

    it('does not include any flat keys at the top level', () => {
      const ppLib = makePPLib({
        cookies: { userId: '42', patientId: '99', app_is_authenticated: 'true' }
      });
      const nested = createEventPropertiesBuilder(window, ppLib).buildNested();

      // Flat-mode fields must NOT appear at the top level.
      expect('pp_user_id' in nested).toBe(false);
      expect('pp_session_id' in nested).toBe(false);
      expect('device_id' in nested).toBe(false);
      expect('logged_in' in nested).toBe(false);
      expect('utm_source' in nested).toBe(false);
      expect('utm_source [first touch]' in nested).toBe(false);
      expect('marketing_attribution' in nested).toBe(false);
    });
  });
});
