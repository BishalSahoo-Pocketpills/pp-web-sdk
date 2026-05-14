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

function makePPLib(opts?: {
  cookies?: Record<string, string>;
  attribution?: {
    current?: { source: string; medium: string; campaign: string; referrer: string } | null;
    first?: { source: string; medium: string; campaign: string; referrer: string } | null;
    last?: { source: string; medium: string; campaign: string; referrer: string } | null;
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

    it('skips fields already registered as Mixpanel super-properties', () => {
      const ppLib = makePPLib();
      const flat = createEventPropertiesBuilder(window, ppLib).buildFlat();

      // These are registered separately as super-properties; including them
      // again would just bloat the per-event payload.
      expect(flat['utm_source [first touch]']).toBeUndefined();
      expect(flat['utm_medium [first touch]']).toBeUndefined();
      expect(flat['utm_campaign [first touch]']).toBeUndefined();
      expect(flat['utm_source [last touch]']).toBeUndefined();
      expect(flat['utm_medium [last touch]']).toBeUndefined();
      expect(flat['utm_campaign [last touch]']).toBeUndefined();
      expect(flat.marketing_attribution).toBeUndefined();
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
});
