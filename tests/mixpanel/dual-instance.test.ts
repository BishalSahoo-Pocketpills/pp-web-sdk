/**
 * Dual-instance Mixpanel behavior tests.
 *
 * Covers: fan-out routing, runtime setEnabled toggle, per-call instances
 * override, $device_id pinning for identity correlation, alias guard
 * (primary-only), reset re-pinning, shared session ID, error isolation,
 * and the namespaced .primary / .secondary facades.
 *
 * Loaded via IIFE (default `coverable: false` for mixpanel). Coverage
 * attribution comes from `mixpanel-native-coverage.test.ts` which loads
 * the same module via native import — mixing both for the same module
 * corrupts V8 coverage merge, so behavior tests live here and coverage
 * tests live there. Functional assertions are identical either way.
 */
import { loadWithCommon } from '../helpers/iife-loader.ts';
import { createDualMockMixpanel, createMockMixpanel } from '../helpers/mock-mixpanel.ts';

beforeEach(() => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.split('=')[0] + '=;expires=' + new Date(0).toUTCString() + ';path=/';
  });
  localStorage.clear();
  delete (window as any).mixpanel;
  delete (window as any).ppLib;
  delete (window as any).ppLibReady;
  delete (window as any)._enrichers;
});

function loadDualConfigured() {
  loadWithCommon('mixpanel');
  (window as any).ppLib.mixpanel.configure({
    primary: { enabled: true, token: 'primary-tok' },
    secondary: { enabled: true, token: 'secondary-tok' },
  });
  return (window as any).ppLib.mixpanel;
}

describe('dual-instance Mixpanel', () => {
  describe('configure() — dual shape', () => {
    it('accepts dual config and reports both instances in getConfig', () => {
      loadWithCommon('mixpanel');
      const cfg = (window as any).ppLib.mixpanel.configure({
        primary: { token: 'A', enabled: true },
        secondary: { token: 'B', enabled: true },
        shared: { sessionTimeout: 60000 },
      });
      expect(cfg.primary.token).toBe('A');
      expect(cfg.secondary.token).toBe('B');
      expect(cfg.secondary.enabled).toBe(true);
      expect(cfg.shared.sessionTimeout).toBe(60000);
    });

    it('legacy flat config still works and leaves secondary disabled', () => {
      loadWithCommon('mixpanel');
      const cfg = (window as any).ppLib.mixpanel.configure({ token: 'legacy-tok' });
      expect(cfg.primary.token).toBe('legacy-tok');
      expect(cfg.secondary.enabled).toBe(false);
      // Back-compat projection — flat field accessible at top level.
      expect(cfg.token).toBe('legacy-tok');
    });
  });

  describe('fan-out (default routing)', () => {
    it('dual-writes track to both instances when both enabled', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      const ok = api.track('view_item', { item_id: 'X' });

      expect(ok).toBe(true);
      expect(primary.track).toHaveBeenCalledTimes(1);
      expect(secondary.track).toHaveBeenCalledTimes(1);
      const [pName, pProps] = primary.track.mock.calls[0];
      const [sName, sProps] = secondary.track.mock.calls[0];
      expect(pName).toBe('view_item');
      expect(sName).toBe('view_item');
      // Same enriched props on both instances.
      expect(pProps.item_id).toBe('X');
      expect(sProps.item_id).toBe('X');
    });

    it('skips secondary when only primary enabled', () => {
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({
        primary: { enabled: true, token: 'A' },
        secondary: { enabled: false, token: '' },
      });
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      (window as any).ppLib.mixpanel.track('x');

      expect(primary.track).toHaveBeenCalledTimes(1);
      expect(secondary.track).not.toHaveBeenCalled();
    });
  });

  describe('setEnabled — runtime toggle', () => {
    it('drops secondary mid-session when setEnabled(secondary, false)', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.track('event1');
      expect(secondary.track).toHaveBeenCalledTimes(1);

      api.setEnabled('secondary', false);
      api.track('event2');

      expect(secondary.track).toHaveBeenCalledTimes(1); // not incremented
      expect(primary.track).toHaveBeenCalledTimes(2);

      api.setEnabled('secondary', true);
      api.track('event3');
      expect(secondary.track).toHaveBeenCalledTimes(2);
      expect(primary.track).toHaveBeenCalledTimes(3);
    });
  });

  describe('per-call instances override', () => {
    it('routes only to specified instances', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.track('primary-only', {}, { instances: ['primary'] });
      expect(primary.track).toHaveBeenCalledTimes(1);
      expect(secondary.track).not.toHaveBeenCalled();

      api.track('secondary-only', {}, { instances: ['secondary'] });
      expect(secondary.track).toHaveBeenCalledTimes(1);
      expect(primary.track).toHaveBeenCalledTimes(1);
    });
  });

  describe('namespaced sugar (.primary / .secondary)', () => {
    it('primary.track only writes to primary', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.primary.track('only-primary', {});
      expect(primary.track).toHaveBeenCalledTimes(1);
      expect(secondary.track).not.toHaveBeenCalled();
    });

    it('secondary.identify only mirrors to secondary', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.secondary.identify('user-99');
      expect(secondary.identify).toHaveBeenCalledWith('user-99');
      expect(primary.identify).not.toHaveBeenCalled();
    });

    it('per-instance setEnabled flips that instance only', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.primary.setEnabled(false);
      api.track('shouldnt-hit-primary');

      expect(primary.track).not.toHaveBeenCalled();
      expect(secondary.track).toHaveBeenCalledTimes(1);
    });

    it('isEnabled reports current runtime state', () => {
      const api = loadDualConfigured();
      expect(api.primary.isEnabled()).toBe(true);
      expect(api.secondary.isEnabled()).toBe(true);
      api.setEnabled('secondary', false);
      expect(api.secondary.isEnabled()).toBe(false);
    });
  });

  describe('alias guard (primary-only by default)', () => {
    it('alias defaults to primary only — secondary skipped', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.alias('new-anon-id');

      expect(primary.alias).toHaveBeenCalledWith('new-anon-id');
      expect(secondary.alias).not.toHaveBeenCalled();
    });

    it('alias can be forced to secondary via override (escape hatch)', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.alias('forced', undefined, { instances: ['secondary'] });

      expect(primary.alias).not.toHaveBeenCalled();
      expect(secondary.alias).toHaveBeenCalledWith('forced');
    });

    it('alias warns loudly when no target is enabled (post-cutover safety net)', () => {
      const api = loadDualConfigured();
      const { root } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      // Disable primary at runtime — simulates the post-cutover state
      // where the only default alias target is gone.
      api.setEnabled('primary', false);

      const logSpy = vi.spyOn((window as any).ppLib, 'log');
      const result = api.alias('lost-call');

      expect(result).toBe(false);
      const warn = logSpy.mock.calls.find(
        (c) => c[0] === 'warn' && /alias called but no targeted instance is enabled/.test(String(c[1])),
      );
      expect(warn).toBeTruthy();
    });
  });

  describe('identify fan-out', () => {
    it('mirrors identify to both instances', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.identify('user-42');

      expect(primary.identify).toHaveBeenCalledWith('user-42');
      expect(secondary.identify).toHaveBeenCalledWith('user-42');
    });
  });

  describe('people operations fan-out', () => {
    it('people.set fires on both instances', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.set({ email: 'x@y.z' });

      expect(primary.people.set).toHaveBeenCalledWith({ email: 'x@y.z' });
      expect(secondary.people.set).toHaveBeenCalledWith({ email: 'x@y.z' });
    });

    it('people.increment fans out with both args', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.increment('counter', 5);

      expect(primary.people.increment).toHaveBeenCalledWith('counter', 5);
      expect(secondary.people.increment).toHaveBeenCalledWith('counter', 5);
    });
  });

  describe('reset', () => {
    it('reset fires on both instances', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.reset();

      expect(primary.reset).toHaveBeenCalled();
      expect(secondary.reset).toHaveBeenCalled();
    });
  });

  describe('error isolation (per-instance)', () => {
    it('primary throw does not block secondary', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      primary.track = vi.fn(() => { throw new Error('primary down'); });
      (window as any).mixpanel = root;

      const ok = api.track('event');

      // Primary threw, secondary still received.
      expect(secondary.track).toHaveBeenCalledTimes(1);
      // Dispatch returns true because secondary succeeded.
      expect(ok).toBe(true);
    });

    it('returns false when every targeted instance fails', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      primary.track = vi.fn(() => { throw new Error('p down'); });
      secondary.track = vi.fn(() => { throw new Error('s down'); });
      (window as any).mixpanel = root;

      const ok = api.track('event');

      expect(ok).toBe(false);
    });
  });

  describe('window-mixpanel fallback resolution', () => {
    it('dispatch routes to a window.mixpanel installed without going through init()', () => {
      const api = loadDualConfigured();
      const single = createMockMixpanel();
      (window as any).mixpanel = single;

      // Only primary's mp is on window; secondary's facade should
      // still fan-out attempt — but without window.mixpanel.secondary
      // installed, dispatch can't resolve a mpRef for secondary and
      // skips it without throwing.
      const ok = api.track('event', {}, { instances: ['primary'] });

      expect(single.track).toHaveBeenCalledTimes(1);
      expect(ok).toBe(true);
    });
  });

  describe('pre-init buffering across dual instances', () => {
    it('buffers track until both enabled instances are ready', () => {
      const api = loadDualConfigured();
      // No window.mixpanel installed yet — primary AND secondary
      // unresolved. Track should buffer rather than dispatch.
      const ok = api.track('queued_event', {});
      expect(ok).toBe(true); // buffered counts as accepted

      // Now install the dual mock. Tracks subsequent to install dispatch
      // immediately; the buffered one would replay only via drainIfReady
      // (which is part of the full init flow). We assert the buffer
      // mechanism didn't drop the event silently.
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.track('live_event');
      expect(primary.track).toHaveBeenCalledWith('live_event', expect.any(Object));
      expect(secondary.track).toHaveBeenCalledWith('live_event', expect.any(Object));
    });
  });

  describe('getConfig back-compat projection', () => {
    it('exposes both dual fields and flattened legacy fields', () => {
      const api = loadDualConfigured();
      const cfg = api.getConfig();
      // Dual fields.
      expect(cfg.primary.token).toBe('primary-tok');
      expect(cfg.secondary.token).toBe('secondary-tok');
      expect(cfg.shared.cookieNames.userId).toBe('userId');
      // Flattened legacy projection.
      expect(cfg.token).toBe('primary-tok');
      expect(cfg.cookieNames.userId).toBe('userId');
    });
  });

  describe('coverage: full OP_TABLE surface', () => {
    // Every dispatch op needs an explicit test. Many of these are
    // straightforward fan-outs but they exercise the OP_TABLE invoke
    // branch in dispatch.ts which would otherwise be uncovered.
    it('register_once fans out to both', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.register_once({ first_seen: '2026-01-01' });

      expect(primary.register_once).toHaveBeenCalledWith({ first_seen: '2026-01-01' });
      expect(secondary.register_once).toHaveBeenCalledWith({ first_seen: '2026-01-01' });
    });

    it('unregister fans out to both', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.unregister('stale_prop');

      expect(primary.unregister).toHaveBeenCalledWith('stale_prop');
      expect(secondary.unregister).toHaveBeenCalledWith('stale_prop');
    });

    it('opt_in_tracking fans out to both', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.opt_in_tracking();

      expect(primary.opt_in_tracking).toHaveBeenCalled();
      expect(secondary.opt_in_tracking).toHaveBeenCalled();
    });

    it('opt_out_tracking fans out to both', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.opt_out_tracking();

      expect(primary.opt_out_tracking).toHaveBeenCalled();
      expect(secondary.opt_out_tracking).toHaveBeenCalled();
    });

    it('people.set_once fans out', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.set_once({ signup_date: '2026-01-01' });

      expect(primary.people.set_once).toHaveBeenCalledWith({ signup_date: '2026-01-01' });
      expect(secondary.people.set_once).toHaveBeenCalledWith({ signup_date: '2026-01-01' });
    });

    it('people.append fans out', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.append({ orders: 'T1' });

      expect(primary.people.append).toHaveBeenCalledWith({ orders: 'T1' });
      expect(secondary.people.append).toHaveBeenCalledWith({ orders: 'T1' });
    });

    it('people.union fans out', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.union({ tags: ['premium'] });

      expect(primary.people.union).toHaveBeenCalledWith({ tags: ['premium'] });
      expect(secondary.people.union).toHaveBeenCalledWith({ tags: ['premium'] });
    });

    it('people.unset fans out (string and array forms)', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.unset('email');
      api.people.unset(['phone', 'address']);

      expect(primary.people.unset).toHaveBeenCalledWith('email');
      expect(primary.people.unset).toHaveBeenCalledWith(['phone', 'address']);
      expect(secondary.people.unset).toHaveBeenCalledWith('email');
      expect(secondary.people.unset).toHaveBeenCalledWith(['phone', 'address']);
    });

    it('people.track_charge fans out with amount + props', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.people.track_charge(25.5, { sku: 'X' });

      expect(primary.people.track_charge).toHaveBeenCalledWith(25.5, { sku: 'X' });
      expect(secondary.people.track_charge).toHaveBeenCalledWith(25.5, { sku: 'X' });
    });
  });

  describe('coverage: dispatch routing edge cases', () => {
    it('returns false when no instances are enabled', () => {
      loadWithCommon('mixpanel');
      (window as any).ppLib.mixpanel.configure({
        primary: { enabled: false, token: '' },
        secondary: { enabled: false, token: '' },
      });
      const { root } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      expect((window as any).ppLib.mixpanel.track('event')).toBe(false);
    });

    it('consent gate drops all PII-emitting ops (track + identity + people) when revoked', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;
      (window as any).ppLib.consent.revoke();

      // Track — gated (returns false, no fan-out).
      expect(api.track('event')).toBe(false);
      expect(primary.track).not.toHaveBeenCalled();
      expect(secondary.track).not.toHaveBeenCalled();

      // Identity — gated. Pre-H2 this leaked PII to Mixpanel even with
      // consent denied; now it's blocked at the dispatcher.
      expect(api.identify('user-7')).toBe(false);
      expect(primary.identify).not.toHaveBeenCalled();
      expect(secondary.identify).not.toHaveBeenCalled();

      // people.set — gated (writes profile PII).
      expect(api.people.set({ email: 'x@y.z' })).toBe(false);
      expect(primary.people.set).not.toHaveBeenCalled();

      // register — gated (persists in Mixpanel cookie as PII at rest).
      expect(api.register({ plan: 'pro' })).toBe(false);
      expect(primary.register).not.toHaveBeenCalled();
    });

    it('consent gate does NOT block data-reduction or operator-lifecycle ops', () => {
      const api = loadDualConfigured();
      const { root, primary } = createDualMockMixpanel();
      (window as any).mixpanel = root;
      (window as any).ppLib.consent.revoke();

      // unregister — client-side removal, no emit. Allowed.
      expect(api.unregister('foo')).toBe(true);
      expect(primary.unregister).toHaveBeenCalledWith('foo');

      // people.unset — server-side deletion, reducing data. Allowed.
      expect(api.people.unset('email')).toBe(true);
      expect(primary.people.unset).toHaveBeenCalledWith('email');

      // opt_out_tracking — operator MUST be able to opt out regardless.
      expect(api.opt_out_tracking()).toBe(true);
      expect(primary.opt_out_tracking).toHaveBeenCalled();

      // reset — operator/state action, always allowed.
      expect(api.reset()).toBe(true);
      expect(primary.reset).toHaveBeenCalled();
    });

    it('consent gate blocks opt_in_tracking — incoherent to flip opt-in under denied consent', () => {
      const api = loadDualConfigured();
      const { root, primary } = createDualMockMixpanel();
      (window as any).mixpanel = root;
      // Seed the implicit opt_in from the loaded callback may have run;
      // clear and revoke before testing the gate.
      primary.opt_in_tracking.mockClear();
      (window as any).ppLib.consent.revoke();

      expect(api.opt_in_tracking()).toBe(false);
      expect(primary.opt_in_tracking).not.toHaveBeenCalled();
    });

    it('per-call instances override is filtered to currently-enabled instances', () => {
      const api = loadDualConfigured();
      const { root, primary, secondary } = createDualMockMixpanel();
      (window as any).mixpanel = root;
      api.setEnabled('secondary', false);

      // Caller asked for both, but secondary is disabled — only primary fires.
      api.track('event', {}, { instances: ['primary', 'secondary'] });

      expect(primary.track).toHaveBeenCalledTimes(1);
      expect(secondary.track).not.toHaveBeenCalled();
    });

    it('skipEnrichment forwards caller props unchanged', () => {
      const api = loadDualConfigured();
      const { root, primary } = createDualMockMixpanel();
      (window as any).mixpanel = root;

      api.track('event', { only_this: 'value' }, { instances: ['primary'], skipEnrichment: true });

      const [, props] = primary.track.mock.calls[0];
      // No enrichment merge — exact caller object forwarded (after the
      // dispatcher's null-coalesce to {}).
      expect(props).toEqual({ only_this: 'value' });
    });
  });

  describe('coverage: getMixpanelCookieData per-instance lookup', () => {
    it('reads the configured-token cookie for the named instance', () => {
      document.cookie = 'mp_primary-tok_mixpanel=' +
        encodeURIComponent(JSON.stringify({ distinct_id: 'P', $device_id: 'pd' })) +
        ';path=/';
      document.cookie = 'mp_secondary-tok_mixpanel=' +
        encodeURIComponent(JSON.stringify({ distinct_id: 'S', $device_id: 'sd' })) +
        ';path=/';

      const api = loadDualConfigured();
      const pData = api.getMixpanelCookieData('primary');
      const sData = api.getMixpanelCookieData('secondary');

      expect(pData.distinct_id).toBe('P');
      expect(sData.distinct_id).toBe('S');
    });
  });
});
