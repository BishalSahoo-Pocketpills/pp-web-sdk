import { createEventPropertiesEnricher } from '../../src/datalayer/enrichers/event-properties';
import type { PPLib } from '../../src/types/common.types';

function makePPLib(cookies?: Record<string, string>): PPLib {
  return {
    getCookie: vi.fn((name: string) => (cookies || {})[name] || null),
    session: {
      getOrCreateSessionId: vi.fn(() => 'test-session-id'),
      clearSession: vi.fn(),
    },
    attribution: {
      getCurrent: vi.fn(() => ({ source: 'google', medium: 'cpc', campaign: 'spring', referrer: 'google.com' })),
      getFirstTouch: vi.fn(() => ({ source: 'facebook', medium: 'social', campaign: 'launch', referrer: 'facebook.com' })),
      getLastTouch: vi.fn(() => ({ source: 'google', medium: 'cpc', campaign: 'spring', referrer: 'google.com' })),
      get: vi.fn(() => ({ source: 'google', medium: 'cpc', campaign: 'spring', platform: 'google_ads' })),
    },
    log: vi.fn(),
  } as any;
}

function makeConfig() {
  return {
    cookieNames: { userId: 'userId', patientId: 'patientId', appAuth: 'app_is_authenticated', country: 'country' },
    defaults: { platform: 'web' },
  } as any;
}

describe('createEventPropertiesEnricher', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds all required eventProperties to events', () => {
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
    expect(ep.is_logged_in).toBe(true);
    expect(ep.device_id).toBeTruthy();

    // URLs
    expect(ep.current_url).toBeDefined();
    expect(ep.url).toBeDefined();

    // Session
    expect(ep.pp_session_id).toBe('test-session-id');
    expect(typeof ep.pp_timestamp).toBe('number');
    expect(ep.platform).toBe('web');

    // UTM current
    expect(ep.utm_source).toBe('google');
    expect(ep.utm_medium).toBe('cpc');
    expect(ep.utm_campaign).toBe('spring');

    // UTM first touch
    expect(ep['utm_source [first touch]']).toBe('facebook');
    expect(ep['utm_medium [first touch]']).toBe('social');
    expect(ep['utm_campaign [first touch]']).toBe('launch');

    // UTM last touch
    expect(ep['utm_source [last touch]']).toBe('google');
    expect(ep['utm_medium [last touch]']).toBe('cpc');
    expect(ep['utm_campaign [last touch]']).toBe('spring');

    // User context
    expect(ep.country).toBe('CA');
    expect(typeof ep.browser).toBe('string');
    expect(typeof ep.device_type).toBe('string');
    expect(typeof ep.referrer).toBe('string');
    expect(ep.initial_referrer).toBe('facebook.com');

    // Page
    expect(arg.page).toBeDefined();
    expect(arg.page.url).toBeDefined();
    expect(typeof arg.page.title).toBe('string');
    expect(typeof arg.page.referrer).toBe('string');
  });

  it('pp_distinct_id falls back to device_id when not logged in', () => {
    const ppLib = makePPLib();
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties.is_logged_in).toBe(false);
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

  it('handles missing attribution service gracefully', () => {
    const ppLib = makePPLib();
    (ppLib as any).attribution = undefined;
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const ep = mockPush.mock.calls[0][0].eventProperties;
    expect(ep.utm_source).toBe('');
    expect(ep['utm_source [first touch]']).toBe('$direct');
    expect(ep['utm_medium [first touch]']).toBe('none');
    expect(ep['utm_campaign [first touch]']).toBe('none');
    expect(ep['utm_source [last touch]']).toBe('$direct');
    expect(ep['utm_medium [last touch]']).toBe('none');
    expect(ep['utm_campaign [last touch]']).toBe('none');
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

  it('persists device_id across calls', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);

    wrapped({ event: 'first' });
    const id1 = mockPush.mock.calls[0][0].eventProperties.device_id;

    wrapped({ event: 'second' });
    const id2 = mockPush.mock.calls[1][0].eventProperties.device_id;

    expect(id1).toBe(id2);
    expect(localStorage.getItem('pp_device_id')).toBe(id1);
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

  it('detects device type from user agent', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const deviceType = mockPush.mock.calls[0][0].eventProperties.device_type;
    expect(['desktop', 'mobile', 'tablet']).toContain(deviceType);
  });
});
