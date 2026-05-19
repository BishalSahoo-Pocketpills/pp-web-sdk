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

/**
 * Convert a FixtureTouch into an ExtendedUtmTouch and serialise it as a
 * cookie value. `platform: 'unknown'` (any non-empty) is the canary that
 * tells captureUtmTouches the cookie has been written before, so it won't
 * be reset by the migrateLegacyMktgCookiesOnce shim.
 */
function fixtureToExtendedCookie(touch: FixtureTouch): string {
  return JSON.stringify({
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    source: touch.source,
    medium: touch.medium,
    campaign: touch.campaign,
    platform: 'unknown',
    clickId: '',
    referrer: touch.referrer || '',
    referrerDomain: touch.referrerDomain || '',
    landingPage: touch.landingPage || '',
    timestamp: '2026-05-18T00:00:00Z',
  });
}

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
  // The builder reads attribution data exclusively from cookies. Tests
  // that need first/last touch data must pass them explicitly via the
  // `attribution` option (which seeds cookies); tests that don't pass it
  // operate on the natural captureUtmTouches output for the current visit
  // (direct, $direct fallbacks).
  const attribution = opts?.attribution ?? undefined;
  const session = opts?.session === null ? undefined : (opts?.session || { id: 'test-session-id' });

  // Pre-seed the consolidated pp_utm_*_touch cookies from the fixture's
  // first/last touches, plus pp_utm_session so captureUtmTouches doesn't
  // rotate last-touch on the implicit "direct" current visit. Replaces the
  // pre-Phase-4 ppLib.attribution mock — the builder now reads attribution
  // exclusively from cookies.
  if (attribution) {
    if (attribution.first) {
      document.cookie = 'pp_utm_first_touch=' +
        encodeURIComponent(fixtureToExtendedCookie(attribution.first)) + ';path=/';
    }
    if (attribution.last) {
      document.cookie = 'pp_utm_last_touch=' +
        encodeURIComponent(fixtureToExtendedCookie(attribution.last)) + ';path=/';
      document.cookie = 'pp_utm_session=' +
        encodeURIComponent(JSON.stringify({ ts: Date.now() })) + ';path=/';
    }
  }

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
    // The builder calls ppLib.Security.sanitize on every URL param before
    // normalization (via extractParams). Tests use a pass-through stub so
    // utm_source=google stays 'google'.
    Security: { sanitize: (v: string) => v },
    log
  };
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

    it('uses $direct fallbacks across all UTM dimensions when first/last/current touch are missing', () => {
      const ppLib = makePPLib({
        attribution: { current: null, first: null, last: null, summary: null }
      });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      // Per the Analytics UTM events spec, every utm_* [first/last touch] key
      // defaults to '$direct' (not 'none') when no value is set.
      expect(bundle.eventProperties['utm_source [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_medium [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_campaign [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_content [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_term [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_medium [last touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_campaign [last touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_content [last touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_term [last touch]']).toBe('$direct');
      // Current-visit utm_* mirror the same convention for cross-dimension consistency.
      expect(bundle.eventProperties.utm_source).toBe('$direct');
      expect(bundle.eventProperties.utm_medium).toBe('$direct');
      expect(bundle.eventProperties.utm_campaign).toBe('$direct');
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

    it('falls back to "-1" sentinel for pp_user_id / pp_patient_id when cookies are absent', () => {
      // Anonymous visitors (no userId/patientId cookies) get the '-1'
      // sentinel rather than '' so the fields survive 3E's empty-string
      // strip and remain queryable / filterable in Mixpanel.
      const ppLib = makePPLib({ cookies: {} });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties.pp_user_id).toBe('-1');
      expect(bundle.eventProperties.pp_patient_id).toBe('-1');
      expect(bundle.eventProperties.logged_in).toBe('false');

      // Verify the flat (Mixpanel) payload preserves '-1' through stripping.
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();
      expect(flat.pp_user_id).toBe('-1');
      expect(flat.pp_patient_id).toBe('-1');
    });

    it('on a first-ever visit with no prior touch cookies, captures a direct touch', () => {
      // No pre-seeded touch cookies → captureUtmTouches creates a fresh
      // direct-visit touch (utm_* = $direct, normalized platform = 'direct').
      // initial_referrer / referrer_domain stay empty because document.referrer
      // is empty in jsdom by default. marketing_attribution is the resolved
      // direct touch, NOT null — the builder always captures on first use,
      // so a non-null normalized last-touch is the steady state.
      const ppLib = makePPLib({ attribution: null });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['utm_source [first touch]']).toBe('$direct');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('$direct');
      expect(bundle.eventProperties.marketing_attribution).toMatchObject({
        platform: 'direct',
        source: 'direct',
        medium: 'none',
      });
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

    it('keeps device_id stable across UTM-changed re-visits (branch 2 / audit P7+T5)', () => {
      // Audit P7/T5: same browser hitting the site with different UTMs
      // (e.g. google → facebook campaign) was generating a new device_id,
      // breaking cross-session user joins. The cross-subdomain cookie from
      // branch 1B owns the fix; this test locks in the contract so a
      // regression can't slip through.
      const originalURL = document.URL;
      try {
        document.cookie = 'pp_device_id=known-device-uuid-v1; path=/';

        // First visit: google UTM.
        Object.defineProperty(document, 'URL', {
          value: 'http://localhost/lp?utm_source=google&utm_medium=cpc',
          writable: true, configurable: true,
        });
        const ppLib1 = makePPLib();
        const idA = createEventPropertiesBuilder(window, ppLib1).build().eventProperties.device_id;
        expect(idA).toBe('known-device-uuid-v1');

        // Second visit (fresh builder, fresh ppLib): facebook UTM.
        // The cookie is still set; device_id MUST read through.
        Object.defineProperty(document, 'URL', {
          value: 'http://localhost/lp?utm_source=facebook&utm_medium=social',
          writable: true, configurable: true,
        });
        const ppLib2 = makePPLib();
        const idB = createEventPropertiesBuilder(window, ppLib2).build().eventProperties.device_id;
        expect(idB).toBe('known-device-uuid-v1');
        expect(idB).toBe(idA);
      } finally {
        Object.defineProperty(document, 'URL', {
          value: originalURL, writable: true, configurable: true,
        });
      }
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

    it('emits empty referrer/referrer_domain and current-URL landing on a direct first-ever visit', () => {
      // No prior touch cookies + no document.referrer → captureUtmTouches
      // records the current URL as landingPage but leaves referrer fields
      // empty. The builder always populates landingPage from the captured
      // visit, so landing_page_url is never empty after a first capture.
      const ppLib = makePPLib({ attribution: null });
      const bundle = createEventPropertiesBuilder(window, ppLib).build();

      expect(bundle.eventProperties['referrer [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer [last touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [first touch]']).toBe('');
      expect(bundle.eventProperties['referrer_domain [last touch]']).toBe('');
      // landing_page_url IS populated from the current visit's URL —
      // captureUtmTouches always records it on first-ever capture.
      expect(typeof bundle.eventProperties['landing_page_url [first touch]']).toBe('string');
      expect(typeof bundle.eventProperties['landing_page_url [last touch]']).toBe('string');
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

      // attribution:null suppresses makePPLib's default fixture cookie seeding —
      // we want a clean slate so the localStorage entries are the only source.
      const ppLib = makePPLib({ attribution: null });
      const builder = createEventPropertiesBuilder(window, ppLib);
      const bundle = builder.build();

      // Values carried over into event properties
      expect(bundle.eventProperties['utm_source [first touch]']).toBe('facebook');
      expect(bundle.eventProperties['utm_medium [first touch]']).toBe('social');
      expect(bundle.eventProperties['utm_source [last touch]']).toBe('google');
      expect(bundle.eventProperties['utm_medium [last touch]']).toBe('cpc');

      // Cookies seeded with JSON payloads (URL-encoded). The cookie carries
      // the ExtendedUtmTouch shape — literal utm_* fields from the legacy
      // localStorage entry, plus the normalized slice filled by per-slice
      // first-touch immutability: the literal slice was already present
      // (locked), but the empty normalized slice got the current direct
      // visit captured into it.
      expect(document.cookie).toContain('pp_utm_first_touch=');
      expect(document.cookie).toContain('pp_utm_last_touch=');
      const decodedFirst = decodeURIComponent((document.cookie.match(/pp_utm_first_touch=([^;]+)/) as RegExpMatchArray)[1]);
      expect(JSON.parse(decodedFirst)).toMatchObject(legacyFirst);
      expect(JSON.parse(decodedFirst)).toMatchObject({ platform: 'direct', source: 'direct', medium: 'none' });

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
      // device_id is in MIXPANEL_DUPLICATE_KEYS — Mixpanel auto-collects
      // it as $device_id / "Device ID". The cross-subdomain pp_device_id
      // value still rides as `pp_distinct_id` (asserted above).
      expect(flat.device_id).toBeUndefined();
      // current_url is in MIXPANEL_DUPLICATE_KEYS — Mixpanel auto-collects
      // it as $current_url. The flat (Mixpanel) shape strips it. The full
      // URL is still available under `url`.
      expect(typeof flat.url).toBe('string');
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
      expect(flat['utm_medium [first touch]']).toBe('$direct');
      expect(flat['utm_campaign [first touch]']).toBe('$direct');
      expect(flat['utm_source [last touch]']).toBe('$direct');
      expect(flat['utm_medium [last touch]']).toBe('$direct');
      expect(flat['utm_campaign [last touch]']).toBe('$direct');
      // marketing_attribution rides per-event as the resolved normalized
      // last-touch. With no seeded fixture, captureUtmTouches
      // builds a direct-visit touch — match-object lets us assert the key
      // dimensions without binding to the full 9-field shape.
      expect(flat.marketing_attribution).toMatchObject({
        platform: 'direct',
        source: 'direct',
        medium: 'none',
      });
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

      // Plain utm_* keys are NOT stripped — Mixpanel's built-in
      // `track_marketing` auto-captures them too, but our SDK ALSO
      // sends them so direct visits surface a `$direct` fallback
      // (Mixpanel auto-capture is absent for keys not in the URL).
      // Same key + same value when URL has UTMs → no duplication.
      expect(flat.utm_source).toBe('google');
      expect(flat.utm_medium).toBe('cpc');
      expect(flat.utm_campaign).toBe('spring');

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('strips Mixpanel-duplicate snake_case keys (browser, device_id, current_url, referrer, initial_referrer) from the flat (Mixpanel) payload', async () => {
      // These fields are present in build() (dataLayer-bound) but stripped
      // from buildFlat() (Mixpanel-bound). Mixpanel auto-collects the
      // same dimensions under its own $-prefixed keys ("Browser",
      // "Current URL", "Device", "Initial Referrer", etc.), so the
      // snake_case duplicates would produce two columns per dimension.
      const ppLib = makePPLib();
      const builder = createEventPropertiesBuilder(window, ppLib);
      const bundle = builder.build();
      const flat = builder.buildFlat();

      // dataLayer still sees these in build().
      expect(bundle.eventProperties).toHaveProperty('browser');
      expect(bundle.eventProperties).toHaveProperty('device');
      expect(bundle.eventProperties).toHaveProperty('device_type');
      expect(bundle.eventProperties).toHaveProperty('device_id');
      expect(bundle.eventProperties).toHaveProperty('current_url');

      // Mixpanel-bound flat shape: each duplicate is absent.
      expect(Object.prototype.hasOwnProperty.call(flat, 'browser')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'device_id')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'current_url')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'referrer')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(flat, 'initial_referrer')).toBe(false);

      // `device` and `device_type` are intentionally KEPT: Mixpanel's
      // $device fills only on mobile (no desktop coverage), and
      // device_type has no Mixpanel equivalent. Asserted via the set
      // directly because jsdom's UA produces empty strings that 3E
      // strips before MIXPANEL_DUPLICATE_KEYS would even see them.
      const { MIXPANEL_DUPLICATE_KEYS } = await import('@src/common/event-properties-builder');
      expect(MIXPANEL_DUPLICATE_KEYS.has('device')).toBe(false);
      expect(MIXPANEL_DUPLICATE_KEYS.has('device_type')).toBe(false);
      expect(MIXPANEL_DUPLICATE_KEYS.has('device_id')).toBe(true);
      // Plain (non-bracket) utm_* are NOT stripped — Mixpanel's built-in
      // `track_marketing` auto-captures the same keys ("UTM Source",
      // "UTM Medium", "UTM Campaign", "UTM Content", "UTM Term", "UTM
      // ID") with identical values when the URL has UTMs. Same key
      // + same value → no duplicate column in Mixpanel; our SDK still
      // provides the `$direct` fallback when the URL is direct.
      expect(MIXPANEL_DUPLICATE_KEYS.has('utm_source')).toBe(false);
      expect(MIXPANEL_DUPLICATE_KEYS.has('utm_medium')).toBe(false);
      expect(MIXPANEL_DUPLICATE_KEYS.has('utm_campaign')).toBe(false);

      // pp_* prefixed and other non-duplicate snake_case keys remain.
      expect(flat).toHaveProperty('pp_session_id');
      expect(flat).toHaveProperty('logged_in');
      expect(flat).toHaveProperty('platform');
      expect(flat).toHaveProperty('url');
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
      // page.title / page.referrer are empty in jsdom; under 3E they're
      // stripped from the wrapper. Url is always non-empty.

      const attribution = nested.attribution as Record<string, unknown>;
      // 3E: null click-IDs are stripped from buildNested (matching buildFlat).
      // Only present keys are populated click IDs; in jsdom no click IDs
      // were set, so the attribution object is {}.
      expect('fbclid' in attribution).toBe(false);
      expect('gclid' in attribution).toBe(false);
      expect('rdt_cid' in attribution).toBe(false);
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

  // ---------------------------------------------------------------------------
  // Marketing attribution semantics — ported from the now-deleted
  // tests/common/attribution.test.ts. These exercise behaviours that used to
  // live in createAttributionService and now live in the builder's
  // captureUtmTouches / buildNormalizedTouch / resolveNormalizedSlice path.
  // ---------------------------------------------------------------------------
  describe('marketing attribution semantics', () => {
    // Replace window.location wholesale — the builder reads location.href,
    // hostname, search, pathname plus document.URL. Tests need all of these
    // aligned so captureUtmTouches sees a coherent visit.
    function setHref(href: string): void {
      const url = new URL(href);
      Object.defineProperty(window, 'location', {
        value: {
          href: href,
          hostname: url.hostname,
          pathname: url.pathname,
          search: url.search,
        },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(document, 'URL', {
        value: href, writable: true, configurable: true,
      });
    }

    function setReferrer(value: string): void {
      Object.defineProperty(document, 'referrer', {
        value: value, writable: true, configurable: true,
      });
    }

    function expireUtmSession(): void {
      document.cookie = 'pp_utm_session=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    }

    beforeEach(() => {
      setHref('http://localhost/landing');
      setReferrer('');
    });

    describe('normalized touch schema', () => {
      it('stores the FULL referrer URL in marketing_attribution, not a classifier label', () => {
        setReferrer('https://www.google.com/search?q=pocketpills');
        setHref('http://localhost/lp/x?utm_source=google&utm_medium=cpc');

        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();

        expect(ma).not.toBeNull();
        expect(ma!.referrer).toBe('https://www.google.com/search?q=pocketpills');
        expect(ma!.referrerDomain).toBe('www.google.com');
      });

      it('uses empty string for both referrer fields on direct visits', () => {
        setReferrer('');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.referrer).toBe('');
        expect(ma!.referrerDomain).toBe('');
      });

      it('returns empty referrerDomain on unparseable referrer (defensive)', () => {
        setReferrer('not a url');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.referrer).toBe('not a url');
        expect(ma!.referrerDomain).toBe('');
      });

      it('stores the full landing URL (href with query), not just pathname', () => {
        setHref('http://localhost/lp/spring?utm_source=fb&utm_medium=social&promo=abc');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.landingPage).toBe('http://localhost/lp/spring?utm_source=fb&utm_medium=social&promo=abc');
      });

      it('strips URL fragment from landing page (OAuth token leak defense)', () => {
        // OAuth implicit-flow callbacks land with the access token in the
        // hash. Persisting that for 2 years in a cookie is a credential
        // leak — buildNormalizedTouch must strip the fragment.
        setHref('http://localhost/oauth/callback?utm_source=email#access_token=secret-abc-xyz&token_type=Bearer');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.landingPage).toBe('http://localhost/oauth/callback?utm_source=email');
        expect(ma!.landingPage.indexOf('access_token')).toBe(-1);
        expect(ma!.landingPage.indexOf('#')).toBe(-1);
      });
    });

    describe('self-referral filter on last-touch (audit 3.b + 3.c)', () => {
      // Pattern: seed an initial last-touch with a real touch, expire the
      // session, simulate a second visit with a controlled referrer, assert
      // whether last-touch was rewritten.
      function seedInitialLastTouch(): void {
        setHref('http://localhost/lp?utm_source=google&utm_medium=cpc&utm_campaign=spring');
        setReferrer('https://www.google.com/');
        createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expireUtmSession();
      }

      it('same-host referral, no new UTM, session expired → last-touch NOT updated', () => {
        // localhost → localhost: user mid-funnel pressed refresh on signup.
        // Without the self-referral filter, last-touch would flip to "localhost".
        seedInitialLastTouch();

        setHref('http://localhost/signup');
        setReferrer('http://localhost/cart');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();

        expect(ma!.source).toBe('google');
        expect(ma!.campaign).toBe('spring');
      });

      it('cross-subdomain referral via cookieDomain → last-touch NOT updated', () => {
        // www.pocketpills.com → try.pocketpills.com: different hostnames
        // but both under .pocketpills.com — the cookieDomain rule covers it.
        seedInitialLastTouch();

        setHref('https://try.pocketpills.com/checkout');
        setReferrer('https://www.pocketpills.com/cart');

        const ppLib = makePPLib({ attribution: null });
        (ppLib as any).config.cookieDomain = '.pocketpills.com';
        const ma = createEventPropertiesBuilder(window, ppLib).getMarketingAttribution();
        expect(ma!.source).toBe('google');
      });

      it('external referral, no new UTM, session expired → last-touch IS updated', () => {
        // bing.com → localhost: a real new touch via an external referrer.
        seedInitialLastTouch();

        setHref('http://localhost/lp');
        setReferrer('https://www.bing.com/search?q=pocketpills');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();

        expect(ma!.platform).toBe('organic_search');
        expect(ma!.source).not.toBe('google');
      });

      it('same-host referral WITH new UTM params → last-touch IS updated (UTM beats veto)', () => {
        seedInitialLastTouch();

        setHref('http://localhost/lp?utm_source=facebook&utm_medium=social&utm_campaign=relaunch');
        setReferrer('http://localhost/home');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();

        expect(ma!.source).toBe('facebook');
        expect(ma!.campaign).toBe('relaunch');
      });
    });

    describe('first-touch immutability (audit T9)', () => {
      it('does not overwrite first-touch on a re-visit with new UTMs (both slices locked)', () => {
        // Initial visit: google/cpc lands the FULL extended shape — both
        // literal utm_* and normalized slices populated.
        setHref('http://localhost/lp?utm_source=google&utm_medium=cpc&utm_campaign=spring');
        setReferrer('https://www.google.com/');
        createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();

        const bundleA = createEventPropertiesBuilder(window, makePPLib({ attribution: null })).build();
        expect(bundleA.eventProperties['utm_source [first touch]']).toBe('google');
        expect(bundleA.eventProperties['utm_medium [first touch]']).toBe('cpc');
        expect(bundleA.eventProperties['utm_campaign [first touch]']).toBe('spring');
        expect(bundleA.eventProperties['referrer_domain [first touch]']).toBe('www.google.com');
        const originalLanding = bundleA.eventProperties['landing_page_url [first touch]'];
        expect(originalLanding).toContain('utm_source=google');

        // Second visit (fresh builder): facebook UTM. First-touch must NOT
        // change on EITHER slice — both literal and normalized are populated,
        // so the per-slice immutability locks both.
        setHref('http://localhost/lp?utm_source=facebook&utm_medium=social&utm_campaign=relaunch');
        setReferrer('https://www.facebook.com/');
        const bundleB = createEventPropertiesBuilder(window, makePPLib({ attribution: null })).build();

        // Literal first-touch slice is locked.
        expect(bundleB.eventProperties['utm_source [first touch]']).toBe('google');
        expect(bundleB.eventProperties['utm_medium [first touch]']).toBe('cpc');
        expect(bundleB.eventProperties['utm_campaign [first touch]']).toBe('spring');
        // Normalized first-touch slice is locked.
        expect(bundleB.eventProperties['referrer_domain [first touch]']).toBe('www.google.com');
        expect(bundleB.eventProperties['landing_page_url [first touch]']).toBe(originalLanding);
        // Last-touch DOES follow the new visit (the literal slice rotates
        // per-key on URL params, the normalized slice rotates on hasNewParams).
        expect(bundleB.eventProperties['utm_source [last touch]']).toBe('facebook');
        expect(bundleB.eventProperties['utm_medium [last touch]']).toBe('social');
        expect(bundleB.eventProperties['referrer_domain [last touch]']).toBe('www.facebook.com');
      });

      it('per-slice asymmetric immutability: locked literal slice allows normalized to fill, and vice versa', () => {
        // SCENARIO A: visitor arrived via the legacy localStorage path —
        // pp_utm_first_touch has utm_* literal data but the normalized slice
        // is empty (the localStorage shape predates the consolidation).
        // On the next visit, the normalized slice should fill from the
        // current capture WHILE the literal slice stays locked.
        const partialFirstUtmOnly = {
          utm_source: 'twitter', utm_medium: 'social', utm_campaign: 'launch',
          utm_content: '', utm_term: '',
          // Normalized slice empty — canary `platform` is the empty-marker.
          source: '', medium: '', campaign: '', platform: '', clickId: '',
          referrer: '', referrerDomain: '', landingPage: '', timestamp: '',
        };
        document.cookie = 'pp_utm_first_touch=' +
          encodeURIComponent(JSON.stringify(partialFirstUtmOnly)) + ';path=/';

        // Current visit: bing organic search. No URL utm_*, so the literal
        // first-touch slice has nothing new to add anyway — but the empty
        // normalized slice should pick up the current visit's data.
        setHref('http://localhost/lp');
        setReferrer('https://www.bing.com/search?q=foo');
        const bundleA = createEventPropertiesBuilder(window, makePPLib({ attribution: null })).build();

        // Literal slice is LOCKED: keeps the legacy utm_*=twitter data.
        expect(bundleA.eventProperties['utm_source [first touch]']).toBe('twitter');
        expect(bundleA.eventProperties['utm_medium [first touch]']).toBe('social');
        expect(bundleA.eventProperties['utm_campaign [first touch]']).toBe('launch');
        // Normalized slice was empty → filled from the current bing visit.
        expect(bundleA.eventProperties['referrer_domain [first touch]']).toBe('www.bing.com');

        // SCENARIO B: visitor arrived via the legacy pp_mktg_* path —
        // pp_utm_first_touch has normalized data but the literal slice is
        // empty (the mktg cookies never carried utm_* literals). On the
        // next visit with URL utm params, the literal slice should fill
        // WHILE the normalized slice stays locked.
        document.cookie.split(';').forEach(c => {
          const name = c.split('=')[0].trim();
          if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        });
        const partialFirstNormalizedOnly = {
          utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
          source: 'pinterest', medium: 'social', campaign: 'mktg-era',
          platform: 'organic_social', clickId: '',
          referrer: 'https://www.pinterest.com/', referrerDomain: 'www.pinterest.com',
          landingPage: 'http://localhost/old-lp', timestamp: '2024-01-01T00:00:00.000Z',
        };
        document.cookie = 'pp_utm_first_touch=' +
          encodeURIComponent(JSON.stringify(partialFirstNormalizedOnly)) + ';path=/';

        setHref('http://localhost/lp?utm_source=newcampaign&utm_medium=email&utm_campaign=q2');
        setReferrer('');
        const bundleB = createEventPropertiesBuilder(window, makePPLib({ attribution: null })).build();

        // Literal slice was empty → filled from current URL params.
        expect(bundleB.eventProperties['utm_source [first touch]']).toBe('newcampaign');
        expect(bundleB.eventProperties['utm_medium [first touch]']).toBe('email');
        expect(bundleB.eventProperties['utm_campaign [first touch]']).toBe('q2');
        // Normalized slice is LOCKED: keeps the mktg-era pinterest data.
        expect(bundleB.eventProperties['referrer_domain [first touch]']).toBe('www.pinterest.com');
        expect(bundleB.eventProperties['landing_page_url [first touch]']).toBe('http://localhost/old-lp');
      });
    });

    describe('platform classifier (organic search / social / direct)', () => {
      it('detects organic_search via google referrer hostname', () => {
        setReferrer('https://www.google.com/search?q=foo');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.platform).toBe('organic_search');
      });

      it('detects organic_social via facebook referrer', () => {
        setReferrer('https://www.facebook.com/');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.platform).toBe('organic_social');
      });

      it('classifies same-origin referrer as direct (not "internal" leakage)', () => {
        setHref('http://localhost/page');
        setReferrer('http://localhost/other');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        // Internal referrers don't hit any organic-domain branch and have no
        // UTM, so platform falls through to 'direct'.
        expect(ma!.platform).toBe('direct');
      });

      it('falls back to direct when document.referrer is empty', () => {
        setReferrer('');
        const ma = createEventPropertiesBuilder(window, makePPLib({ attribution: null }))
          .getMarketingAttribution();
        expect(ma!.platform).toBe('direct');
      });
    });

    describe('legacy pp_mktg_* migration shim', () => {
      it('folds pp_mktg_first_touch / pp_mktg_last_touch normalized data into pp_utm_*_touch and deletes the legacy cookies', () => {
        const mktgFirst = {
          source: 'facebook', medium: 'social', campaign: 'launch', platform: 'organic_social',
          clickId: '', landingPage: 'http://localhost/first',
          referrer: 'https://www.facebook.com/', referrerDomain: 'www.facebook.com',
          timestamp: '2024-01-01T00:00:00.000Z',
        };
        const mktgLast = {
          source: 'google', medium: 'cpc', campaign: 'spring', platform: 'google_ads',
          clickId: 'abc', landingPage: 'http://localhost/last',
          referrer: 'https://www.google.com/', referrerDomain: 'www.google.com',
          timestamp: '2024-06-01T00:00:00.000Z',
        };
        document.cookie = 'pp_mktg_first_touch=' + encodeURIComponent(JSON.stringify(mktgFirst)) + ';path=/';
        document.cookie = 'pp_mktg_last_touch=' + encodeURIComponent(JSON.stringify(mktgLast)) + ';path=/';
        document.cookie = 'pp_mktg_session=' + encodeURIComponent(JSON.stringify({ ts: Date.now() })) + ';path=/';

        const bundle = createEventPropertiesBuilder(window, makePPLib({ attribution: null })).build();

        // First-touch normalized fields inherited from the legacy mktg cookie.
        expect(bundle.eventProperties['referrer_domain [first touch]']).toBe('www.facebook.com');
        expect(bundle.eventProperties['landing_page_url [first touch]']).toBe('http://localhost/first');

        // Legacy cookies cleared so they don't linger for up to 2 years.
        expect(document.cookie).not.toMatch(/pp_mktg_first_touch=[^;]+/);
        expect(document.cookie).not.toMatch(/pp_mktg_last_touch=[^;]+/);
        expect(document.cookie).not.toMatch(/pp_mktg_session=[^;]+/);
      });
    });
  });
});
