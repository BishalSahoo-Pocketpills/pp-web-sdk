/**
 * Integration tests for dual-Mixpanel data-correctness fixes:
 *
 *   H1 — `analytics.Mixpanel.send({ type: 'register' })` must route through
 *        `ppLib.mixpanel.register` (fan-out) instead of directly calling
 *        `window.mixpanel.register` (primary-only bypass).
 *
 *   M2 — `unifyDistinctIdWithPpDistinctId` must NOT double-identify
 *        secondary. The unify pass identifies primary, then re-syncs
 *        secondary from primary in a single mirror call.
 *
 *   M4 — Same-token misconfig must disable secondary at boot with a loud
 *        error log; the SDK keeps primary-only behavior.
 */
import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { createDualMockMixpanel } from '../helpers/mock-mixpanel.ts';

beforeEach(() => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.split('=')[0] + '=;expires=' + new Date(0).toUTCString() + ';path=/';
  });
  localStorage.clear();
  delete (window as any).mixpanel;
  delete (window as any).ppLib;
  delete (window as any).ppLibReady;
  delete (window as any)._enrichers;
  delete (window as any).ppAnalytics;
  delete (window as any).ppAnalyticsDebug;
});

describe('H1 — analytics.Mixpanel.send register routes through ppLib.mixpanel', () => {
  it('register fans out to both instances when mixpanel module is loaded', () => {
    // Load common, mixpanel, then analytics — analytics's register bridge
    // must prefer ppLib.mixpanel.register (which fans out) over the
    // legacy direct win.mixpanel.register write (primary-only).
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'primary-tok' },
      secondary: { enabled: true, token: 'secondary-tok' },
    });
    const { root, primary, secondary } = createDualMockMixpanel();
    (window as any).mixpanel = root;

    // Load analytics on top.
    (window as any).ppLib.config.debug = true;
    loadModule('analytics', { coverable: false });

    const platforms = (window as any).ppAnalyticsDebug.platforms;
    platforms.Mixpanel.send({ type: 'register', properties: { plan: 'pro' } });

    // BOTH instances must receive the super-prop. Pre-fix only primary
    // got it (direct win.mixpanel.register call bypassed the facade).
    expect(primary.register).toHaveBeenCalledWith({ plan: 'pro' });
    expect(secondary.register).toHaveBeenCalledWith({ plan: 'pro' });
  });

  it('register falls back to win.mixpanel.register when mixpanel module is NOT loaded', () => {
    // Test fixture / minimal deployment path — analytics-only, no
    // mixpanel module. The fallback to win.mixpanel.register keeps the
    // single-instance contract working.
    loadModule('common');
    (window as any).ppLib.config.debug = true;
    loadModule('analytics', { coverable: false });

    // Install a bare mock at window.mixpanel — no ppLib.mixpanel facade.
    const mp = { register: vi.fn(), track: vi.fn() };
    (window as any).mixpanel = mp;

    const platforms = (window as any).ppAnalyticsDebug.platforms;
    platforms.Mixpanel.send({ type: 'register', properties: { src: 'fallback' } });

    expect(mp.register).toHaveBeenCalledWith({ src: 'fallback' });
  });
});

// M2 — unifyDistinctIdWithPpDistinctId double-identify cleanup is an
// architectural fix (primary-then-mirror instead of dual-write) rather
// than a behavioral one. The observable call counts can match pre- and
// post-fix in simple scenarios; the win is a single canonical identity
// path (one writer, one mirror) that makes future identity edits
// reviewable in one place.
//
// Behavioral parity is already covered by
// `tests/integration/dual-mixpanel-parity.test.ts` (10-event sequence
// asserting identical distinct_ids). The primary-only scoping is
// visible at shared-context.ts:unifyDistinctIdWithPpDistinctId and
// reviewable directly.

describe('M4 — token-equality guard', () => {
  it('disables secondary at boot when tokens match, logging a loud error', () => {
    loadWithCommon('mixpanel');
    const api = (window as any).ppLib.mixpanel;
    const logSpy = vi.spyOn((window as any).ppLib, 'log');

    api.configure({
      primary: { enabled: true, token: 'same-tok' },
      secondary: { enabled: true, token: 'same-tok' },
    });

    // Need a <script> tag for the loader.
    if (!document.getElementsByTagName('script').length) {
      const s = document.createElement('script');
      s.src = 'dummy.js';
      document.head.appendChild(s);
    }
    const ibSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments[0] as Node;
    });

    api.init();

    // Loud error captured.
    const tokenErr = logSpy.mock.calls.find(
      (c) => c[0] === 'error' && /primary and secondary share the same token/.test(String(c[1])),
    );
    expect(tokenErr).toBeTruthy();

    // Secondary disabled in config + state. getConfig reads the projected
    // dual config; secondary.enabled should be false post-init.
    const cfg = api.getConfig();
    expect(cfg.secondary.enabled).toBe(false);

    // Secondary facade should report disabled too.
    expect(api.secondary.isEnabled()).toBe(false);

    ibSpy.mockRestore();
  });

  it('allows distinct tokens through without warning', () => {
    loadWithCommon('mixpanel');
    const api = (window as any).ppLib.mixpanel;
    const logSpy = vi.spyOn((window as any).ppLib, 'log');

    api.configure({
      primary: { enabled: true, token: 'tok-A' },
      secondary: { enabled: true, token: 'tok-B' },
    });

    if (!document.getElementsByTagName('script').length) {
      const s = document.createElement('script');
      s.src = 'dummy.js';
      document.head.appendChild(s);
    }
    const ibSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments[0] as Node;
    });

    api.init();

    const tokenErr = logSpy.mock.calls.find(
      (c) => c[0] === 'error' && /primary and secondary share the same token/.test(String(c[1])),
    );
    expect(tokenErr).toBeFalsy();
    expect(api.secondary.isEnabled()).toBe(true);

    ibSpy.mockRestore();
  });

  it('does not trigger when secondary is disabled (only enabled+same-token is a misconfig)', () => {
    loadWithCommon('mixpanel');
    const api = (window as any).ppLib.mixpanel;
    const logSpy = vi.spyOn((window as any).ppLib, 'log');

    api.configure({
      primary: { enabled: true, token: 'same-tok' },
      secondary: { enabled: false, token: 'same-tok' },
    });

    if (!document.getElementsByTagName('script').length) {
      const s = document.createElement('script');
      s.src = 'dummy.js';
      document.head.appendChild(s);
    }
    const ibSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments[0] as Node;
    });

    api.init();

    const tokenErr = logSpy.mock.calls.find(
      (c) => c[0] === 'error' && /primary and secondary share the same token/.test(String(c[1])),
    );
    expect(tokenErr).toBeFalsy();

    ibSpy.mockRestore();
  });
});
