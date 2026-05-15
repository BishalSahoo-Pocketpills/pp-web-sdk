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
    expect(mergedProps.logged_in).toBe('true');
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

  it('includes utm_* [first/last touch] and marketing_attribution in the per-event payload (parity with dataLayer)', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({ token: 'tok' });
    (window as any).mixpanel = createMockMixpanel();

    (window as any).ppLib.mixpanel.track('view_item', {});

    const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
    // Per the data-team contract: parity with the dataLayer payload.
    // Mixpanel still registers these as super-properties on the side, but
    // they also ride per-event so BigQuery / GTM consumers see them
    // directly without depending on the super-property side channel.
    expect(mergedProps['utm_source [first touch]']).toBe('$direct');
    expect(mergedProps['utm_medium [first touch]']).toBe('none');
    expect(mergedProps['utm_campaign [first touch]']).toBe('none');
    expect(mergedProps['utm_source [last touch]']).toBe('$direct');
    expect(mergedProps['utm_medium [last touch]']).toBe('none');
    expect(mergedProps['utm_campaign [last touch]']).toBe('none');
    expect('marketing_attribution' in mergedProps).toBe(true);
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

  describe('emitMode dispatch', () => {
    const NESTED_KEYS = ['page', 'userProperties', 'eventProperties', 'attribution'];
    // Representative flat fields that MUST appear at the top level in
    // flat/dual modes and MUST be absent in nested mode.
    const FLAT_FIELDS = [
      'pp_user_id', 'pp_patient_id', 'pp_session_id', 'device_id', 'logged_in',
      'platform', 'browser', 'device', 'device_type', 'Country', 'utm_source',
      'utm_source [first touch]', 'utm_source [last touch]', 'marketing_attribution',
    ];

    it('defaults to "dual" mode', () => {
      loadWithCommon('mixpanel');
      const cfg = (window as any).ppLib.mixpanel.configure();
      expect(cfg.emitMode).toBe('dual');
    });

    it('"flat" mode emits ONLY flat keys — no nested wrappers at top level', () => {
      setCookie('userId', '42');
      setCookie('patientId', '99');
      setCookie('app_is_authenticated', 'true');
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({ token: 'tok', emitMode: 'flat' });
      (window as any).mixpanel = createMockMixpanel();

      (window as any).ppLib.mixpanel.track('view_item', {});

      const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
      // Flat fields present.
      for (let i = 0; i < FLAT_FIELDS.length; i++) {
        expect(mergedProps).toHaveProperty(FLAT_FIELDS[i]);
      }
      // Nested wrappers absent.
      for (let j = 0; j < NESTED_KEYS.length; j++) {
        expect(NESTED_KEYS[j] in mergedProps).toBe(false);
      }
    });

    it('"nested" mode emits ONLY the 4 nested wrappers — no flat keys at top level', () => {
      setCookie('userId', '42');
      setCookie('patientId', '99');
      setCookie('app_is_authenticated', 'true');
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({ token: 'tok', emitMode: 'nested' });
      (window as any).mixpanel = createMockMixpanel();

      (window as any).ppLib.mixpanel.track('view_item', {});

      const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
      // Exactly the four wrappers at top level (caller passed no props).
      expect(Object.keys(mergedProps).sort()).toEqual(['attribution', 'eventProperties', 'page', 'userProperties']);
      // Nested wrappers have the expected shape.
      expect(mergedProps.userProperties).toMatchObject({ userId: '42', patientId: '99' });
      expect(mergedProps.eventProperties).toMatchObject({ pp_user_id: '42', logged_in: 'true' });

      // No leakage of flat fields at the top.
      for (let i = 0; i < FLAT_FIELDS.length; i++) {
        expect(FLAT_FIELDS[i] in mergedProps).toBe(false);
      }
    });

    it('"dual" mode emits BOTH flat keys AND the 4 nested wrappers', () => {
      setCookie('userId', '42');
      setCookie('patientId', '99');
      setCookie('app_is_authenticated', 'true');
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({ token: 'tok', emitMode: 'dual' });
      (window as any).mixpanel = createMockMixpanel();

      (window as any).ppLib.mixpanel.track('view_item', {});

      const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];

      // All flat fields present.
      for (let i = 0; i < FLAT_FIELDS.length; i++) {
        expect(mergedProps).toHaveProperty(FLAT_FIELDS[i]);
      }
      // All four nested wrappers present.
      for (let j = 0; j < NESTED_KEYS.length; j++) {
        expect(mergedProps).toHaveProperty(NESTED_KEYS[j]);
      }
      // Nested wrapper contents intact.
      expect(mergedProps.eventProperties).toMatchObject({ pp_user_id: '42' });
      // Flat copy of the same field also intact.
      expect(mergedProps.pp_user_id).toBe('42');
    });

    it('caller props still win in nested mode (e.g. override eventProperties wrapper)', () => {
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({ token: 'tok', emitMode: 'nested' });
      (window as any).mixpanel = createMockMixpanel();

      const override = { eventProperties: { custom: 'value' } };
      (window as any).ppLib.mixpanel.track('view_item', override);

      const [, mergedProps] = (window as any).mixpanel.track.mock.calls[0];
      expect(mergedProps.eventProperties).toEqual({ custom: 'value' });
    });
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
