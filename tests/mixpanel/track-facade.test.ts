/**
 * Tests for the SDK's Mixpanel track facade — `ppLib.mixpanel.track(...)`.
 *
 * The facade is the single internal entry point for sending events to
 * Mixpanel. Other modules (analytics, ecommerce, event-source) call it
 * instead of `window.mixpanel.track` so every event picks up the canonical
 * event-properties context.
 */
import { loadWithCommon } from '../helpers/iife-loader.ts';
import { setCookie } from '../helpers/mock-cookies.ts';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';

beforeEach(() => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.split('=')[0] + '=;expires=' + new Date(0).toUTCString() + ';path=/';
  });
  localStorage.clear();
  delete (window as any).mixpanel;
  delete (window as any).ppLib;
  delete (window as any)._enrichers;
});

describe('ppLib.mixpanel.track facade', () => {
  it('returns false and logs nothing when win.mixpanel is not loaded', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });

    const result = (window as any).ppLib.mixpanel.track('view_item', { items: [] });

    expect(result).toBe(false);
    expect((window as any).mixpanel).toBeUndefined();
  });

  it('returns false when CONFIG.enabled is false', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok', enabled: false });
    (window as any).mixpanel = createMockMixpanel();

    const result = (window as any).ppLib.mixpanel.track('view_item', {});

    expect(result).toBe(false);
    expect((window as any).mixpanel.track).not.toHaveBeenCalled();
  });

  it('returns false on empty or non-string event name', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    expect((window as any).ppLib.mixpanel.track('')).toBe(false);
    expect((window as any).ppLib.mixpanel.track(null as any)).toBe(false);
    expect((window as any).ppLib.mixpanel.track(undefined as any)).toBe(false);
    expect((window as any).mixpanel.track).not.toHaveBeenCalled();
  });

  it('forwards to win.mixpanel.track and merges enriched context with caller props', () => {
    setCookie('userId', '42');
    setCookie('patientId', '99');
    setCookie('app_is_authenticated', 'true');
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    const callerProps = { items: [{ item_id: 'X' }], value: '12.50', currency: 'CAD' };
    const result = (window as any).ppLib.mixpanel.track('view_item', callerProps);

    expect(result).toBe(true);
    expect((window as any).mixpanel.track).toHaveBeenCalledTimes(1);

    const [eventName, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    expect(eventName).toBe('view_item');

    // Caller's props pass through.
    expect(mergedProps.items).toEqual(callerProps.items);
    expect(mergedProps.value).toBe('12.50');
    expect(mergedProps.currency).toBe('CAD');

    // Enriched context fields are merged in.
    expect(mergedProps.pp_user_id).toBe('42');
    expect(mergedProps.pp_patient_id).toBe('99');
    expect(mergedProps.is_logged_in).toBe(true);
    expect(typeof mergedProps.device_id).toBe('string');
    expect(typeof mergedProps.current_url).toBe('string');
    expect(typeof mergedProps.pp_timestamp).toBe('number');
  });

  it('caller props win on key collision', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    // current_url is a builder-emitted field; caller override should stick.
    (window as any).ppLib.mixpanel.track('custom', { current_url: '/override' });

    const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    expect(mergedProps.current_url).toBe('/override');
  });

  it('does not include Mixpanel super-property keys in the per-event payload', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    (window as any).ppLib.mixpanel.track('view_item', {});

    const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    // These are registered as Mixpanel super-properties elsewhere; sending
    // them per-event would just bloat the payload.
    expect(mergedProps['utm_source [first touch]']).toBeUndefined();
    expect(mergedProps['utm_medium [first touch]']).toBeUndefined();
    expect(mergedProps['utm_campaign [first touch]']).toBeUndefined();
    expect(mergedProps['utm_source [last touch]']).toBeUndefined();
    expect(mergedProps['utm_medium [last touch]']).toBeUndefined();
    expect(mergedProps['utm_campaign [last touch]']).toBeUndefined();
    expect(mergedProps.marketing_attribution).toBeUndefined();
  });

  it('forwards bare props (no enrichment) when enrichTrack is false', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok', enrichTrack: false });
    (window as any).mixpanel = createMockMixpanel();

    (window as any).ppLib.mixpanel.track('view_item', { items: [] });

    const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    expect(mergedProps).toEqual({ items: [] });
    expect(mergedProps.device_id).toBeUndefined();
    expect(mergedProps.pp_user_id).toBeUndefined();
  });

  it('treats missing properties argument as empty', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    const result = (window as any).ppLib.mixpanel.track('pageview');

    expect(result).toBe(true);
    const [eventName, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    expect(eventName).toBe('pageview');
    // Builder context still attached
    expect(typeof mergedProps.device_id).toBe('string');
  });

  it('returns false and logs error when the underlying mixpanel.track throws', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    const mp = createMockMixpanel();
    mp.track = vi.fn(() => { throw new Error('boom'); });
    (window as any).mixpanel = mp;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (window as any).ppLib.config.debug = true;

    const result = (window as any).ppLib.mixpanel.track('view_item', {});

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
