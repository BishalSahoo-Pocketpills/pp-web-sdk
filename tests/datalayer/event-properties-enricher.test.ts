import { createEventPropertiesEnricher } from '../../src/datalayer/enrichers/event-properties';
import { createEventPropertiesBuilder } from '../../src/common/event-properties-builder';
import { createGetQueryParam } from '../../src/common/url';
import { createSetCookie, createDeleteCookie } from '../../src/common/cookies';
import type { PPLib } from '../../src/types/common.types';

/**
 * Seed a pp_utm_first_touch / pp_utm_last_touch cookie with given normalized
 * data so tests can reproduce attribution fixtures without going through the
 * builder. `platform: 'unknown'` is a non-empty canary that flags the cookie
 * as already-written (suppresses the mktg migration shim and lets the
 * session veto carry the data forward when the inline sessionTs is fresh).
 *
 * `activeSession=true` (default) sets sessionTs to Date.now() so the cookie
 * stays valid as "in-session" — captureUtmTouches won't rotate it. Pass
 * false to seed an expired-session cookie.
 */
function seedTouchCookie(
  cookieName: string,
  data: { source: string; medium: string; campaign: string; referrer: string; referrerDomain?: string; landingPage?: string },
  activeSession: boolean = true,
): void {
  const payload = {
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    source: data.source,
    medium: data.medium,
    campaign: data.campaign,
    platform: 'unknown',
    clickId: '',
    referrer: data.referrer,
    referrerDomain: data.referrerDomain || '',
    landingPage: data.landingPage || '',
    timestamp: '2026-05-18T00:00:00Z',
    sessionTs: activeSession ? Date.now() : 0,
  };
  document.cookie = cookieName + '=' + encodeURIComponent(JSON.stringify(payload)) + ';path=/';
}

// Retained for callsite clarity but now a no-op — session anchor lives
// inline on pp_utm_last_touch.sessionTs (set by seedTouchCookie when
// `activeSession=true`). Kept so existing test call sites read sensibly.
function seedActiveSession(): void { /* sessionTs is set by seedTouchCookie */ }

function makePPLib(cookies?: Record<string, string>): PPLib {
  const log = vi.fn();
  // Read-through getCookie: serves the seeded cookies map first, then falls
  // back to live document.cookie so PersistentValue-managed entries (e.g.
  // pp_device_id, pp_utm_*) round-trip.
  const getCookieReal = (name: string): string | null => {
    if (cookies && Object.prototype.hasOwnProperty.call(cookies, name)) return cookies[name];
    try {
      if (!name || !document.cookie) return null;
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : null;
    } catch (e) { return null; }
  };
  const ppLib = {
    config: { cookieDomain: undefined } as never,
    getCookie: vi.fn(getCookieReal),
    setCookie: createSetCookie(document, window, log),
    deleteCookie: createDeleteCookie(document, window, log),
    getQueryParam: createGetQueryParam(),
    session: {
      getOrCreateSessionId: vi.fn(() => 'test-session-id'),
      clearSession: vi.fn(),
    },
    // The builder calls ppLib.Security.sanitize on every URL param before
    // normalization (via extractParams); tests use an identity stub.
    Security: { sanitize: (v: string) => v },
    log,
  } as unknown as PPLib;
  // Wire up the shared builder the same way common module does in production.
  ppLib.eventPropertiesBuilder = createEventPropertiesBuilder(window, ppLib);
  return ppLib;
}

function makeConfig() {
  return {
    cookieNames: { userId: 'userId', patientId: 'patientId', appAuth: 'app_is_authenticated', country: 'country' },
    defaults: { platform: 'web' },
    // Existing shape-contract tests verify presence of fields whose values
    // are empty under jsdom (browser, device_type, pp_session_id). Stripping
    // is tested separately below. This file's other assertions don't depend
    // on stripping behavior.
    preserveEmptyProperties: true,
  } as any;
}

function makeStripConfig() {
  return {
    cookieNames: { userId: 'userId', patientId: 'patientId', appAuth: 'app_is_authenticated', country: 'country' },
    defaults: { platform: 'web' },
    preserveEmptyProperties: false,
  } as any;
}

describe('createEventPropertiesEnricher', () => {
  // Captured at module load — restored in beforeEach so URL pollution from a
  // failing test can't leak utm_* into the next test's captureUtmTouches.
  const baselineURL = document.URL;

  beforeEach(() => {
    localStorage.clear();
    // Clear cookies — PersistentValue now uses cookies for pp_device_id and
    // pp_utm_*, so test isolation needs them wiped alongside localStorage.
    document.cookie.split(';').forEach(c => {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
    Object.defineProperty(document, 'URL', {
      value: baselineURL, writable: true, configurable: true,
    });
  });

  it('adds all required eventProperties to events', () => {
    // utm_* keys are sourced literally from URL (not from attribution
    // service), so stub document.URL for the assertions to land.
    Object.defineProperty(document, 'URL', {
      value: 'http://localhost/test?utm_source=google&utm_medium=cpc&utm_campaign=spring',
      writable: true,
      configurable: true,
    });
    window.localStorage.clear();

    // Seed first-touch with a facebook referrer so the initial_referrer
    // assertion below picks it up. captureUtmTouches sees the existing
    // populated cookie and the active session marker, so it carries the
    // normalized slice forward instead of overwriting it.
    seedTouchCookie('pp_utm_first_touch', {
      source: 'facebook', medium: 'social', campaign: 'launch',
      referrer: 'facebook.com',
    });
    seedTouchCookie('pp_utm_last_touch', {
      source: 'google', medium: 'cpc', campaign: 'spring',
      referrer: 'google.com',
    });
    seedActiveSession();
    // Mixpanel is the source of truth for $device_id; the mixpanel
    // module syncs it into pp_device_id on its loaded callback. Seed
    // the cookie directly to simulate post-sync state.
    document.cookie = 'pp_device_id=mp-sourced-uuid;path=/';

    const ppLib = makePPLib({ userId: '42', patientId: '99', app_is_authenticated: 'true', country: 'CA' });
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'pageview' });

    const arg = mockPush.mock.calls[0][0];
    const ep = arg.eventProperties;

    // userProperties
    const up = arg.userProperties;
    expect(up).toBeDefined();
    expect(up.userId).toBe('42');
    expect(up.patientId).toBe('99');
    expect(up.pp_distinct_id).toBe('42'); // logged in → userId

    // Core identity
    expect(ep.pp_user_id).toBe('42');
    expect(ep.pp_patient_id).toBe('99');
    expect(ep.logged_in).toBe('true');
    expect(ep.device_id).toBeTruthy();

    // URLs
    expect(ep.current_url).toBeDefined();
    expect(ep.url).toBeDefined();

    // Session
    expect(ep.pp_session_id).toBe('test-session-id');
    expect(typeof ep.pp_timestamp).toBe('number');
    expect(ep.platform).toBe('web');

    // UTM current — literal URL params.
    expect(ep.utm_source).toBe('google');
    expect(ep.utm_medium).toBe('cpc');
    expect(ep.utm_campaign).toBe('spring');

    // First/last touch — first call to build() captures the current visit's
    // utm_* into localStorage, so both touch keys mirror the current values.
    expect(ep['utm_source [first touch]']).toBe('google');
    expect(ep['utm_medium [first touch]']).toBe('cpc');
    expect(ep['utm_campaign [first touch]']).toBe('spring');

    expect(ep['utm_source [last touch]']).toBe('google');
    expect(ep['utm_medium [last touch]']).toBe('cpc');
    expect(ep['utm_campaign [last touch]']).toBe('spring');

    // User context
    expect(ep.Country).toBe('CA');
    expect(typeof ep.browser).toBe('string');
    expect(typeof ep.device_type).toBe('string');
    expect(typeof ep.referrer).toBe('string');
    expect(ep.initial_referrer).toBe('facebook.com');

    // Page
    expect(arg.page).toBeDefined();
    expect(arg.page.url).toBeDefined();
    expect(typeof arg.page.title).toBe('string');
    expect(typeof arg.page.referrer).toBe('string');

    // (URL is restored by the next beforeEach.)
  });

  it('pp_distinct_id falls back to device_id when not logged in', () => {
    const ppLib = makePPLib();
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties.logged_in).toBe('false');
    expect(arg.userProperties.pp_distinct_id).toBe(arg.eventProperties.device_id);
  });

  it('skips non-event objects', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ ecommerce: null });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties).toBeUndefined();
  });

  it('uses $direct fallbacks for utm_* when no URL params and no prior touch cookies', () => {
    // ppLib.attribution was retired in favour of the builder. With clean
    // cookies and a URL carrying no utm_* params, every utm_* key in the
    // bundle resolves to '$direct' via captureUtmTouches's first-ever
    // resolver.
    const ppLib = makePPLib();
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const ep = mockPush.mock.calls[0][0].eventProperties;
    // Per the Analytics UTM events spec, every utm_* defaults to '$direct'.
    expect(ep.utm_source).toBe('$direct');
    expect(ep.utm_medium).toBe('$direct');
    expect(ep.utm_campaign).toBe('$direct');
    expect(ep['utm_source [first touch]']).toBe('$direct');
    expect(ep['utm_medium [first touch]']).toBe('$direct');
    expect(ep['utm_campaign [first touch]']).toBe('$direct');
    expect(ep['utm_source [last touch]']).toBe('$direct');
    expect(ep['utm_medium [last touch]']).toBe('$direct');
    expect(ep['utm_campaign [last touch]']).toBe('$direct');
  });

  it('handles missing session service gracefully', () => {
    const ppLib = makePPLib();
    (ppLib as any).session = undefined;
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const ep = mockPush.mock.calls[0][0].eventProperties;
    expect(ep.pp_session_id).toBe('');
  });

  it('reads the same Mixpanel-sourced device_id from pp_device_id cookie across calls', () => {
    // Mixpanel is now the source of truth for $device_id; the mixpanel
    // module syncs it into pp_device_id on mp.init's loaded callback.
    // The enricher just reads that cookie.
    const seededId = 'mp-sourced-device-uuid';
    document.cookie = 'pp_device_id=' + encodeURIComponent(seededId) + ';path=/';

    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);

    wrapped({ event: 'first' });
    const id1 = mockPush.mock.calls[0][0].eventProperties.device_id;

    wrapped({ event: 'second' });
    const id2 = mockPush.mock.calls[1][0].eventProperties.device_id;

    expect(id1).toBe(seededId);
    expect(id2).toBe(seededId);
    expect(localStorage.getItem('pp_device_id')).toBeNull();
  });

  it('reads cookies fresh on each call', () => {
    const cookies: Record<string, string> = { userId: 'initial' };
    const ppLib = makePPLib(cookies);
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);

    wrapped({ event: 'first' });
    expect(mockPush.mock.calls[0][0].eventProperties.pp_user_id).toBe('initial');

    cookies.userId = 'updated';
    wrapped({ event: 'second' });
    expect(mockPush.mock.calls[1][0].eventProperties.pp_user_id).toBe('updated');
  });

  it('detects browser from user agent', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const browser = mockPush.mock.calls[0][0].eventProperties.browser;
    // jsdom UA includes "jsdom" but our parser checks for Chrome, Firefox, etc.
    expect(typeof browser).toBe('string');
  });

  it('3E: strips null / undefined / empty-string from event + user properties by default', () => {
    const ppLib = makePPLib();
    const enricher = createEventPropertiesEnricher(window, ppLib, makeStripConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    // jsdom UA does not match any browser parser branch → browser is '' in
    // the bundle. With stripping enabled (the default), it disappears.
    expect(arg.eventProperties.browser).toBeUndefined();
    // device_type IS populated by the UA parser ('desktop' default), so
    // it survives. Country is empty (no cookie) → stripped.
    expect(arg.eventProperties.Country).toBeUndefined();
    // pp_session_id is non-empty here (session mocked), so it survives.
    expect(arg.eventProperties.pp_session_id).toBe('test-session-id');
    // Non-empty values always pass through.
    expect(arg.eventProperties['utm_source [last touch]']).toBe('$direct');
  });

  it('3E: opt-out via preserveEmptyProperties=true keeps empty strings present', () => {
    const ppLib = makePPLib();
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    // With opt-out the empty strings remain — useful for GTM consumers that
    // expect a fixed schema shape with explicit '' for "not set".
    expect(typeof arg.eventProperties.browser).toBe('string');
    expect(typeof arg.eventProperties.device_type).toBe('string');
  });

  it('detects device type from user agent', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const deviceType = mockPush.mock.calls[0][0].eventProperties.device_type;
    expect(['desktop', 'mobile', 'tablet']).toContain(deviceType);
  });
});
