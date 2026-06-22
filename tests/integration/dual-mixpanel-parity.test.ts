/**
 * Integration: dual-instance Mixpanel parity validation.
 *
 * Mirrors what the migration parity dashboards will assert in production:
 * for the same caller-side action, both primary and secondary Mixpanel
 * projects receive identical event names + property bags + distinct_ids.
 *
 * Drives a realistic mixed event sequence through the full SDK surface
 * (track, identify, register, people.set) and checks per-event parity
 * between the two named-instance spies.
 */
import { loadWithCommon } from '../helpers/iife-loader.ts';
import { createDualMockMixpanel } from '../helpers/mock-mixpanel.ts';

beforeEach(() => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.split('=')[0] + '=;expires=' + new Date(0).toUTCString() + ';path=/';
  });
  localStorage.clear();
  delete (window as any).mixpanel;
  delete (window as any).ppLib;
  delete (window as any)._enrichers;
});

function setupDual() {
  loadWithCommon('mixpanel');
  (window as any).ppLib.mixpanel.configure({
    primary: { enabled: true, token: 'primary-tok', projectName: 'OldProject' },
    secondary: { enabled: true, token: 'secondary-tok', projectName: 'NewProject' },
  });
  const { root, primary, secondary } = createDualMockMixpanel();
  (window as any).mixpanel = root;
  return { api: (window as any).ppLib.mixpanel, primary, secondary };
}

describe('Integration: dual Mixpanel parity', () => {
  it('emits identical event names + props across both instances for a mixed sequence', () => {
    const { api, primary, secondary } = setupDual();

    const events = [
      ['track', 'page_view', { url: '/home' }],
      ['identify', 'user-42'],
      ['register', { plan: 'pro' }],
      ['track', 'view_item', { item_id: 'X', value: '12.50' }],
      ['people.set', { email: 'x@y.z' }],
      ['track', 'add_to_cart', { item_id: 'X', quantity: 2 }],
      ['register', { ab_variant: 'B' }],
      ['track', 'begin_checkout', { value: '25.00' }],
      ['people.increment', 'visits', 1],
      ['track', 'purchase', { transaction_id: 'T1', value: '25.00' }],
    ] as const;

    for (const e of events) {
      if (e[0] === 'track') api.track(e[1], e[2]);
      else if (e[0] === 'identify') api.identify(e[1]);
      else if (e[0] === 'register') api.register(e[1]);
      else if (e[0] === 'people.set') api.people.set(e[1]);
      else if (e[0] === 'people.increment') api.people.increment(e[1], e[2]);
    }

    // Track call parity — same event names + identical property bags.
    expect(primary.track.mock.calls.length).toBe(secondary.track.mock.calls.length);
    expect(primary.track.mock.calls.length).toBe(5); // 5 'track' entries

    for (let i = 0; i < primary.track.mock.calls.length; i++) {
      const [pName, pProps] = primary.track.mock.calls[i];
      const [sName, sProps] = secondary.track.mock.calls[i];
      expect(pName).toBe(sName);
      expect(pProps).toEqual(sProps);
    }

    // Identify parity — both got the same user-id.
    expect(primary.identify.mock.calls).toEqual(secondary.identify.mock.calls);

    // Register parity — same registered super-props across both, in the
    // same order. Note: shared-context registers project name per-instance
    // so we filter that out before comparing.
    const stripProject = (calls: any[]): any[] =>
      calls.filter((c) => !(c[0] && typeof c[0] === 'object' && 'project' in c[0]));
    expect(stripProject(primary.register.mock.calls)).toEqual(
      stripProject(secondary.register.mock.calls),
    );

    // People-set parity.
    expect(primary.people.set.mock.calls).toEqual(secondary.people.set.mock.calls);
    expect(primary.people.increment.mock.calls).toEqual(secondary.people.increment.mock.calls);
  });

  it('per-instance project name is the ONE divergent super-prop (intentional)', () => {
    // Project labels DIFFER by design — they identify the source project in
    // Mixpanel's Debug View. Drive the real boot so the orchestrator registers
    // each instance's projectName via registerProjectName, then assert the
    // divergence directly (the prior test never checked it) AND that every
    // other registered super-prop is identical.
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'primary-tok', projectName: 'OldProject' },
      secondary: { enabled: true, token: 'secondary-tok', projectName: 'NewProject' },
    });

    // init() injects the real SDK <script>; stub the DOM insert so it no-ops.
    if (!document.getElementsByTagName('script').length) {
      const s = document.createElement('script');
      s.src = 'dummy.js';
      document.head.appendChild(s);
    }
    const insertBeforeSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation((node: Node) => node);

    type LoadedOpts = { loaded?: (mp: unknown) => void };
    type InitEntry = [string, LoadedOpts, (string | undefined)?];
    let queued: InitEntry[];
    try {
      window.ppLib.mixpanel.init();
      queued = (window.mixpanel as unknown as { _i: InitEntry[] })._i.slice();
    } finally {
      insertBeforeSpy.mockRestore();
    }

    const { root, primary, secondary } = createDualMockMixpanel();
    window.mixpanel = root as unknown as typeof window.mixpanel;
    queued.forEach(([, opts, name]) => {
      if (opts && typeof opts.loaded === 'function') {
        opts.loaded(name === 'secondary' ? secondary : primary);
      }
    });

    const projectOf = (calls: unknown[][]): unknown =>
      calls.map((c) => c[0]).find((p) => !!p && typeof p === 'object' && 'project' in (p as object));

    // The divergence the test name claims — now actually asserted.
    expect((projectOf(primary.register.mock.calls) as { project?: string }).project).toBe('OldProject');
    expect((projectOf(secondary.register.mock.calls) as { project?: string }).project).toBe('NewProject');

    // Every OTHER registered super-prop must be identical across both.
    const stripProject = (calls: unknown[][]): unknown[][] =>
      calls.filter((c) => !(c[0] && typeof c[0] === 'object' && 'project' in (c[0] as object)));
    expect(stripProject(primary.register.mock.calls)).toEqual(stripProject(secondary.register.mock.calls));
  });

  it('alias fires on primary only (Simplified ID Merge isolation)', () => {
    // The new project (secondary) uses Mixpanel's Simplified ID Merge.
    // alias() is a legacy Original-ID merge concept; passing it to the
    // simplified-merge project corrupts the identity graph. Dispatch's
    // routing table excludes secondary from alias() by default.
    const { api, primary, secondary } = setupDual();

    api.alias('canonical-id', 'temp-id');

    expect(primary.alias.mock.calls.length).toBe(1);
    expect(secondary.alias.mock.calls.length).toBe(0);
  });

  it('runtime setEnabled drops only the toggled instance from the fan-out', () => {
    const { api, primary, secondary } = setupDual();

    api.track('before');
    api.setEnabled('secondary', false);
    api.track('after_disable');
    api.setEnabled('secondary', true);
    api.track('after_reenable');

    expect(primary.track.mock.calls.length).toBe(3);
    // Secondary missed only the middle one.
    expect(secondary.track.mock.calls.length).toBe(2);
    expect(secondary.track.mock.calls[0][0]).toBe('before');
    expect(secondary.track.mock.calls[1][0]).toBe('after_reenable');
  });

  it('per-call instances override narrows scope without affecting subsequent default routing', () => {
    const { api, primary, secondary } = setupDual();

    api.track('default_dual');
    api.track('primary_only', {}, { instances: ['primary'] });
    api.track('back_to_dual');

    expect(primary.track.mock.calls.length).toBe(3);
    expect(secondary.track.mock.calls.length).toBe(2);
    expect(secondary.track.mock.calls.map((c: any) => c[0])).toEqual([
      'default_dual',
      'back_to_dual',
    ]);
  });
});
