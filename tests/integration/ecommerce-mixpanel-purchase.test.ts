/**
 * Integration: common + mixpanel + ecommerce
 *
 * Loads three real IIFE bundles into shared jsdom and exercises the
 * add-to-cart → mixpanel.track + dataLayer.push round trip.
 *
 * Unit tests mock the cross-module surface; this catches integration
 * bugs they hide — property-shape drift between eventPropertiesBuilder
 * and the mixpanel facade, double-counting between ecommerce and event-
 * source, missing GA4 `ecommerce: null` reset, consent-gate bypass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadModule } from '@tests/helpers/iife-loader';

interface MixpanelStub {
  track: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  people: { set: ReturnType<typeof vi.fn> };
  get_distinct_id: () => string;
  identify: ReturnType<typeof vi.fn>;
  opt_in_tracking: ReturnType<typeof vi.fn>;
}

function installMixpanelStub(): MixpanelStub {
  const stub: MixpanelStub = {
    track: vi.fn(),
    register: vi.fn(),
    people: { set: vi.fn() },
    get_distinct_id: () => 'test-distinct-id',
    identify: vi.fn(),
    opt_in_tracking: vi.fn()
  };
  (window as unknown as { mixpanel: MixpanelStub }).mixpanel = stub;
  return stub;
}

function setupProductDOM(): void {
  document.body.innerHTML = `
    <div data-ecommerce-item="prod_abc" data-ecommerce-name="Test Product" data-ecommerce-price="29.99"></div>
  `;
}

describe('Integration: ecommerce → mixpanel + dataLayer', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch (e) { /* ignore */ }
    document.body.innerHTML = '';
    (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
    delete (window as unknown as { ppLib?: unknown }).ppLib;
    delete (window as unknown as { mixpanel?: unknown }).mixpanel;
    delete (window as unknown as { ppLibReady?: unknown }).ppLibReady;
  });

  it('add_to_cart fires a Mixpanel track + GA4 dataLayer push with canonical context', () => {
    loadModule('common');
    loadModule('mixpanel');
    loadModule('ecommerce');

    const mp = installMixpanelStub();
    window.ppLib.mixpanel!.configure({ token: 'test-token' });
    // Bypass the SDK load — install the stub directly and pretend init ran.
    window.ppLib.ecommerce!.trackItem({ item_id: 'prod_abc', item_name: 'Test Product', price: '29.99' });

    // dataLayer push (GA4)
    const dl = window.dataLayer as Array<Record<string, unknown>>;
    const ecommerceResets = dl.filter(e => e.ecommerce === null);
    const purchaseEvents = dl.filter(e => e.event === 'add_to_cart');
    expect(ecommerceResets.length).toBeGreaterThan(0);
    expect(purchaseEvents.length).toBe(1);
    expect((purchaseEvents[0].ecommerce as { items: unknown[] }).items).toHaveLength(1);

    // Mixpanel track via the facade — should be called exactly once,
    // not double-counted by event-source (event-source isn't loaded).
    expect(mp.track).toHaveBeenCalledTimes(1);
    const [eventName, props] = mp.track.mock.calls[0];
    expect(eventName).toBe('add_to_cart');

    // Canonical event-properties context merged in by the facade —
    // these fields come from ppLib.eventPropertiesBuilder (in the configured
    // emitMode, default 'flat') and must reach Mixpanel via the facade's
    // enrichTrack path. If the facade stops calling the builder, OR the
    // builder drops a field, this fails.
    const propsObj = props as Record<string, unknown>;
    expect(typeof propsObj.device_id).toBe('string');
    expect((propsObj.device_id as string).length).toBeGreaterThan(0);
    expect(typeof propsObj.pp_distinct_id).toBe('string');
    // 3E strips empty-string fields when jsdom's UA doesn't match any
    // parser branch. v3.0.3 additionally strips Mixpanel-duplicate keys
    // (browser, device, current_url, etc.) from the Mixpanel payload —
    // the full URL still rides as `url`.
    expect(typeof propsObj.url).toBe('string');
    expect(propsObj.logged_in).toBeDefined();

    // 3D — Mixpanel receives the flat ecommerce shape; dataLayer keeps nested.
    expect(propsObj.ecommerce_currency).toEqual(expect.any(String));
    expect(propsObj.ecommerce_value).toEqual(expect.any(Number));
    expect(propsObj.item_ids).toEqual(['prod_abc']);
    expect((propsObj.item_quantities as number[])).toHaveLength(1);
  });

  it('drops both Mixpanel and dataLayer events when consent is revoked', () => {
    loadModule('common');
    loadModule('mixpanel');
    loadModule('ecommerce');

    const mp = installMixpanelStub();
    window.ppLib.mixpanel!.configure({ token: 'test-token' });
    window.ppLib.consent.revoke();

    window.ppLib.ecommerce!.trackItem({ item_id: 'prod_abc', item_name: 'Test Product', price: '29.99' });

    expect(mp.track).not.toHaveBeenCalled();
    const dl = window.dataLayer as Array<Record<string, unknown>>;
    expect(dl.filter(e => e.event === 'add_to_cart').length).toBe(0);
  });

  it('view_item fires after the GA4 ecommerce reset', () => {
    setupProductDOM();
    loadModule('common');
    loadModule('mixpanel');
    loadModule('ecommerce');

    installMixpanelStub();
    window.ppLib.mixpanel!.configure({ token: 'test-token' });

    window.ppLib.ecommerce!.trackViewItem();

    const dl = window.dataLayer as Array<Record<string, unknown>>;
    const resetIdx = dl.findIndex(e => e.ecommerce === null);
    const viewIdx = dl.findIndex(e => e.event === 'view_item');
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThan(resetIdx);
  });
});
