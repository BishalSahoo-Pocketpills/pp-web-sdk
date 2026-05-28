/**
 * Integration: cross-platform parity between Mixpanel facade ('nested' mode)
 * and the dataLayer enricher.
 *
 * The data-team contract requires identical event-property payloads on both
 * platforms. With `emitMode: 'nested'` the Mixpanel facade emits the same
 * four wrappers the dataLayer enricher attaches. This test verifies the
 * two payloads are structurally equivalent (modulo the `event` field
 * dataLayer adds for GTM routing, and any caller-passed extras the
 * specific track call layered on top).
 *
 * If the two emission paths drift apart (one drops a wrapper, renames a
 * field, etc.) this test catches it before it ships.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadModule } from '@tests/helpers/iife-loader';

interface MixpanelStub {
  track: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  people: { set: ReturnType<typeof vi.fn> };
  get_distinct_id: () => string;
  get_property: (name: string) => unknown;
  identify: ReturnType<typeof vi.fn>;
  opt_in_tracking: ReturnType<typeof vi.fn>;
}

function installMixpanelStub(): MixpanelStub {
  const stub: MixpanelStub = {
    track: vi.fn(),
    register: vi.fn(),
    people: { set: vi.fn() },
    get_distinct_id: () => 'test-distinct-id',
    get_property: (name: string) => (name === '$device_id' ? 'mp-sourced-uuid' : undefined),
    identify: vi.fn(),
    opt_in_tracking: vi.fn()
  };
  (window as unknown as { mixpanel: MixpanelStub }).mixpanel = stub;
  return stub;
}

describe('Integration: Mixpanel nested-mode parity with dataLayer', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch (e) { /* ignore */ }
    document.body.innerHTML = '';
    (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
    delete (window as unknown as { ppLib?: unknown }).ppLib;
    delete (window as unknown as { mixpanel?: unknown }).mixpanel;
    delete (window as unknown as { ppLibReady?: unknown }).ppLibReady;
  });

  it('Mixpanel "nested" payload matches dataLayer payload (modulo the event field)', () => {
    loadModule('common');
    loadModule('mixpanel');
    loadModule('datalayer');

    installMixpanelStub();
    window.ppLib.mixpanel!.configure({ token: 'test-token', emitMode: 'nested' });

    // Push the same event onto dataLayer AND through the Mixpanel facade.
    window.ppLib.mixpanel!.track('test_event');
    window.dataLayer!.push({ event: 'test_event' });

    const mp = (window as unknown as { mixpanel: MixpanelStub }).mixpanel;
    const mpCalls = mp.track.mock.calls;
    expect(mpCalls.length).toBe(1);
    const [, mpProps] = mpCalls[0];

    const dl = window.dataLayer as Array<Record<string, unknown>>;
    const dlEvent = dl.find(e => e.event === 'test_event') as Record<string, unknown> | undefined;
    expect(dlEvent).toBeDefined();

    // Strip the `event` field — GTM routing key, only dataLayer carries it.
    const dlWithoutEvent: Record<string, unknown> = {};
    Object.keys(dlEvent!).forEach(k => { if (k !== 'event') dlWithoutEvent[k] = dlEvent![k]; });

    // Top-level key sets identical.
    const mpKeys = Object.keys(mpProps as Record<string, unknown>).sort();
    const dlKeys = Object.keys(dlWithoutEvent).sort();
    expect(mpKeys).toEqual(dlKeys);
    expect(mpKeys).toEqual(['attribution', 'eventProperties', 'page', 'userProperties']);

    // userProperties wrapper identical.
    expect((mpProps as Record<string, unknown>).userProperties)
      .toEqual(dlWithoutEvent.userProperties);

    // page wrapper identical.
    expect((mpProps as Record<string, unknown>).page)
      .toEqual(dlWithoutEvent.page);

    // attribution wrapper identical.
    expect((mpProps as Record<string, unknown>).attribution)
      .toEqual(dlWithoutEvent.attribution);

    // eventProperties wrapper — pp_timestamp is wall-clock and may differ
    // by a few ms between the two pushes. Compare all other keys exactly.
    const mpEvent = (mpProps as Record<string, unknown>).eventProperties as Record<string, unknown>;
    const dlEventProps = dlWithoutEvent.eventProperties as Record<string, unknown>;
    expect(Object.keys(mpEvent).sort()).toEqual(Object.keys(dlEventProps).sort());
    Object.keys(mpEvent).forEach(k => {
      if (k === 'pp_timestamp') return;
      expect(mpEvent[k]).toEqual(dlEventProps[k]);
    });
    // pp_timestamp present on both, both numeric.
    expect(typeof mpEvent.pp_timestamp).toBe('number');
    expect(typeof dlEventProps.pp_timestamp).toBe('number');
  });
});
