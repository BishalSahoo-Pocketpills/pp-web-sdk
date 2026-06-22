/**
 * Phase 0 (audit remediation) — consent gating + observability.
 *
 * Covers the vetted SDK code changes from the v3.10.7 doc-accuracy audit:
 *   C1 — gate analytics.track() and datalayer pushes on consent
 *   C2 — analytics consent accepts both 'approved' and 'granted' vocabularies
 *   C4 — log the specific GTM event dropped by the rate limiter
 */
import { loadModule, loadWithCommon, flushMixpanelReady } from '@tests/helpers/iife-loader';
import { createMockMixpanel } from '@tests/helpers/mock-mixpanel';
import { createMockDataLayer } from '@tests/helpers/mock-datalayer';

function resetGlobals() {
  delete (window as any).ppLib;
  delete (window as any).ppLibReady;
  delete (window as any).ppAnalytics;
  delete (window as any).ppAnalyticsDebug;
  delete (window as any).mixpanel;
  delete (window as any).dataLayer;
  localStorage.clear();
  sessionStorage.clear();
}

async function loadAnalytics() {
  resetGlobals();
  loadModule('common');
  // Set debug BEFORE analytics evaluates so ppAnalyticsDebug is exposed.
  (window as any).ppLib.config.debug = true;
  (window as any).ppLib.config.verbose = true;
  // IIFE load (re-runs each test via vm) — avoids the ES-module import cache
  // that would otherwise skip re-registering window.ppAnalytics on test #2+.
  loadModule('analytics');
  await flushMixpanelReady();
}

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  resetGlobals();
  vi.restoreAllMocks();
});

// ===========================================================================
// C1 — datalayer consent gate (src/datalayer/events.ts)
// ===========================================================================
describe('Phase 0 / C1 — datalayer consent gate', () => {
  it('suppresses datalayer.push when consent is revoked', () => {
    resetGlobals();
    createMockDataLayer();
    loadWithCommon('datalayer');
    (window as any).ppLib.consent.revoke(); // pp_consent = 'denied'

    const before = (window as any).dataLayer.length;
    (window as any).ppLib.datalayer.push('phase0_blocked', { foo: 'bar' });

    expect((window as any).dataLayer.filter((e: any) => e.event === 'phase0_blocked').length).toBe(0);
    expect((window as any).dataLayer.length).toBe(before);
  });

  it('pushes datalayer.push when consent is granted', () => {
    resetGlobals();
    createMockDataLayer();
    loadWithCommon('datalayer');
    (window as any).ppLib.consent.grant(); // pp_consent = 'granted'

    (window as any).ppLib.datalayer.push('phase0_allowed', { foo: 'bar' });

    expect((window as any).dataLayer.filter((e: any) => e.event === 'phase0_allowed').length).toBe(1);
  });
});

// ===========================================================================
// C1 — analytics.track() consent gate (src/analytics/tracker.ts)
// ===========================================================================
describe('Phase 0 / C1 — analytics.track consent gate', () => {
  it('does not dispatch to GTM when consent is required and denied', async () => {
    await loadAnalytics();
    const dataLayer = createMockDataLayer();
    (window as any).mixpanel = createMockMixpanel();

    (window as any).ppAnalytics.config({
      consent: { required: true, defaultState: 'denied', storageKey: 'pp_consent' }
    });
    (window as any).ppAnalyticsDebug.consent.setConsent(false); // deny + clear 60s cache

    (window as any).ppAnalytics.track('phase0_blocked_event', { a: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(dataLayer.filter((e: any) => e.event === 'phase0_blocked_event').length).toBe(0);
  });

  it('dispatches to GTM when consent is not required (default)', async () => {
    await loadAnalytics();
    const dataLayer = createMockDataLayer();
    (window as any).mixpanel = createMockMixpanel();

    (window as any).ppAnalytics.config({ consent: { required: false } });
    (window as any).ppAnalytics.track('phase0_allowed_event', { a: 1 });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));

    expect(dataLayer.filter((e: any) => e.event === 'phase0_allowed_event').length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// C2 — analytics consent vocabulary tolerance (src/analytics/consent.ts)
// ===========================================================================
describe('Phase 0 / C2 — consent vocabulary tolerance', () => {
  it('treats both "approved" and "granted" as granted, "denied" as not', async () => {
    await loadAnalytics();
    (window as any).ppAnalytics.config({ consent: { required: true, storageKey: 'pp_consent' } });
    const consent = (window as any).ppAnalyticsDebug.consent;

    localStorage.setItem('pp_consent', 'approved'); // analytics vocabulary
    expect(consent.getStoredConsent()).toBe(true);

    localStorage.setItem('pp_consent', 'granted'); // shared common-consent vocabulary
    expect(consent.getStoredConsent()).toBe(true);

    localStorage.setItem('pp_consent', 'denied');
    expect(consent.getStoredConsent()).toBe(false);
  });
});

// ===========================================================================
// C4 — GTM rate-limit drop logging (src/analytics/event-queue.ts)
// ===========================================================================
describe('Phase 0 / C4 — GTM rate-limit drop logging', () => {
  it('logs the specific GTM event dropped when the rate limit is exceeded', async () => {
    await loadAnalytics();
    createMockDataLayer();

    (window as any).ppAnalytics.config({
      consent: { required: false },
      platforms: {
        gtm: { enabled: true, rateLimitMax: 1, rateLimitWindow: 60000 },
        mixpanel: { enabled: false }
      }
    });

    // Capture console output across levels (log routing may differ per level).
    const lines: string[] = [];
    for (const level of ['warn', 'log', 'info', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    }

    // max=1 → first GTM event passes, subsequent ones in-window are dropped.
    (window as any).ppAnalytics.track('rl_event_1', {});
    (window as any).ppAnalytics.track('rl_event_2', {});
    (window as any).ppAnalytics.track('rl_event_3', {});
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10));

    const dropLogged = lines.some((l) => l.includes('GTM event dropped (rate limit)'));
    expect(dropLogged).toBe(true);
  });
});

// ===========================================================================
// Namespace alias — ppLib.analytics + configure() (src/analytics/index.ts)
// ===========================================================================
describe('Phase 0 / namespace — ppLib.analytics alias', () => {
  it('exposes ppLib.analytics === window.ppAnalytics with a working configure() alias', async () => {
    await loadAnalytics();
    expect((window as any).ppLib.analytics).toBeDefined();
    expect((window as any).ppLib.analytics).toBe((window as any).ppAnalytics);
    expect(typeof (window as any).ppLib.analytics.config).toBe('function');
    expect(typeof (window as any).ppLib.analytics.track).toBe('function');
    // configure() is a backward-compatible alias of config()
    const cfg = (window as any).ppLib.analytics.configure({ consent: { required: false } });
    expect(cfg).toBeDefined();
    expect(cfg.consent.required).toBe(false);
  });
});
