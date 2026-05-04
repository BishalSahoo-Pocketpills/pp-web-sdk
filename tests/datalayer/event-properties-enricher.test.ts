import { createEventPropertiesEnricher } from '../../src/datalayer/enrichers/event-properties';
import type { PPLib } from '../../src/types/common.types';

function makePPLib(cookies?: Record<string, string>): PPLib {
  return {
    getCookie: vi.fn((name: string) => (cookies || {})[name] || null),
    session: {
      getOrCreateSessionId: vi.fn(() => 'test-session-id'),
      clearSession: vi.fn(),
    },
    log: vi.fn(),
  } as any;
}

function makeConfig() {
  return {
    cookieNames: { userId: 'userId', patientId: 'patientId' },
    defaults: { platform: 'web' },
  } as any;
}

describe('createEventPropertiesEnricher', () => {
  it('adds eventProperties to events', () => {
    const ppLib = makePPLib({ userId: '42', patientId: '99' });
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const pushed: any[] = [];
    const mockPush = vi.fn((...args: any[]) => { pushed.push(...args); return pushed.length; });

    const wrapped = enricher(mockPush);
    wrapped({ event: 'pageview' });

    expect(mockPush).toHaveBeenCalled();
    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties).toBeDefined();
    expect(arg.eventProperties.pp_user_id).toBe('42');
    expect(arg.eventProperties.pp_patient_id).toBe('99');
    expect(arg.eventProperties.pp_session_id).toBe('test-session-id');
    expect(arg.eventProperties.platform).toBe('web');
    expect(typeof arg.eventProperties.pp_timestamp).toBe('number');
    expect(arg.eventProperties.url).toBeDefined();
    expect(arg.page).toBeDefined();
    expect(arg.page.url).toBeDefined();
    expect(typeof arg.page.title).toBe('string');
    expect(typeof arg.page.referrer).toBe('string');
  });

  it('skips non-event objects', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ ecommerce: null });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties).toBeUndefined();
  });

  it('returns empty strings when cookies are absent', () => {
    const enricher = createEventPropertiesEnricher(window, makePPLib(), makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties.pp_user_id).toBe('');
    expect(arg.eventProperties.pp_patient_id).toBe('');
  });

  it('handles missing session service gracefully', () => {
    const ppLib = makePPLib();
    (ppLib as any).session = undefined;
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);

    const wrapped = enricher(mockPush);
    wrapped({ event: 'test' });

    const arg = mockPush.mock.calls[0][0];
    expect(arg.eventProperties.pp_session_id).toBe('');
  });

  it('reads cookies fresh on each call', () => {
    const cookies: Record<string, string> = { userId: 'initial' };
    const ppLib = makePPLib(cookies);
    const enricher = createEventPropertiesEnricher(window, ppLib, makeConfig());
    const mockPush = vi.fn(() => 1);
    const wrapped = enricher(mockPush);

    wrapped({ event: 'first' });
    expect(mockPush.mock.calls[0][0].eventProperties.pp_user_id).toBe('initial');

    // Update cookie
    cookies.userId = 'updated';
    wrapped({ event: 'second' });
    expect(mockPush.mock.calls[1][0].eventProperties.pp_user_id).toBe('updated');
  });
});
