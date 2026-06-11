/**
 * Boot-resilience tests — covers two correctness gaps in the dual-instance
 * orchestrator:
 *
 *   H3 — caller-supplied `initOptions.loaded` (or other orchestrator-owned
 *        keys) must NOT clobber the boot callback; the SDK warns instead.
 *
 *   H4 — the 15s watchdog must actually force-drain the pre-init queue to
 *        whichever instances loaded. The pre-fix code called drainIfReady()
 *        which gates on "all enabled ready" and is a no-op when an instance
 *        is stuck, leaving the queue buffered forever.
 *
 * Loaded via IIFE — behavior tests live here; native-import coverage tests
 * for the same paths can live in dual-instance-coverage.test.ts.
 */
import { loadWithCommon } from '../helpers/iife-loader.ts';
import { createDualMockMixpanel, createMockMixpanel } from '../helpers/mock-mixpanel.ts';

let insertBeforeSpy: any;

function setupScriptEnv() {
  if (!document.getElementsByTagName('script').length) {
    const s = document.createElement('script');
    s.src = 'dummy.js';
    document.head.appendChild(s);
  }
  insertBeforeSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function () {
    // eslint-disable-next-line prefer-rest-params
    return arguments[0] as Node;
  });
}

function teardownScriptEnv() {
  if (insertBeforeSpy) {
    insertBeforeSpy.mockRestore();
    insertBeforeSpy = null;
  }
}

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

afterEach(() => {
  teardownScriptEnv();
  vi.useRealTimers();
});

describe('H3 — initOptions reserved-key denylist', () => {
  it('refuses to override `loaded` and warns', () => {
    loadWithCommon('mixpanel');
    const callerLoaded = vi.fn();
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppLib.mixpanel.configure({
      primary: {
        enabled: true,
        token: 'primary-tok',
        initOptions: { loaded: callerLoaded },
      },
    });

    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    // The orchestrator's callback must still be installed on the stub queue.
    const queuedOpts = (window as any).mixpanel._i[0][1];
    expect(typeof queuedOpts.loaded).toBe('function');
    expect(queuedOpts.loaded).not.toBe(callerLoaded);

    // Warn message references the reserved key by name so devs can find it.
    const warnCall = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /initOptions\.loaded is reserved/.test(String(c[1])),
    );
    expect(warnCall).toBeTruthy();
  });

  it.each([
    'cross_subdomain_cookie',
    'opt_out_tracking_by_default',
    'track_pageview',
    'api_transport',
    'api_host',
    'persistence',
  ])('refuses to override `%s` and warns', (reservedKey) => {
    loadWithCommon('mixpanel');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppLib.mixpanel.configure({
      primary: {
        enabled: true,
        token: 'primary-tok',
        initOptions: { [reservedKey]: 'caller-supplied-value' },
      },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    const queuedOpts = (window as any).mixpanel._i[0][1];
    expect(queuedOpts[reservedKey]).not.toBe('caller-supplied-value');

    const warned = logSpy.mock.calls.some(
      (c) =>
        c[0] === 'warn' &&
        new RegExp(`initOptions\\.${reservedKey} is reserved`).test(String(c[1])),
    );
    expect(warned).toBe(true);
  });

  it('non-reserved initOptions still pass through to mp.init', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: {
        enabled: true,
        token: 'primary-tok',
        initOptions: {
          persistence_name: 'pp_custom',
          debug: true,
          property_blacklist: ['$current_url'],
        },
      },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    const queuedOpts = (window as any).mixpanel._i[0][1];
    expect(queuedOpts.persistence_name).toBe('pp_custom');
    expect(queuedOpts.debug).toBe(true);
    expect(queuedOpts.property_blacklist).toEqual(['$current_url']);
  });

  it('reserved-key warning fires per-instance — secondary too', () => {
    loadWithCommon('mixpanel');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p', initOptions: { loaded: vi.fn() } },
      secondary: { enabled: true, token: 's', initOptions: { loaded: vi.fn() } },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    const warnings = logSpy.mock.calls.filter(
      (c) => c[0] === 'warn' && /initOptions\.loaded is reserved/.test(String(c[1])),
    );
    // One warn per instance.
    expect(warnings.length).toBe(2);
  });
});

describe('Per-instance boot profile — persistence + legacy cookie sweep', () => {
  it('primary inits with `persistence: "cookie"`', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p-tok' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    const queued = (window as any).mixpanel._i;
    const primaryEntry = queued.find(
      (e: any[]) => e[0] === 'p-tok' && (e[2] === undefined || e[2] === 'mixpanel'),
    );
    expect(primaryEntry).toBeTruthy();
    expect(primaryEntry[1].persistence).toBe('cookie');
  });

  it('secondary inits with `persistence: "localStorage"` so only primary writes a cookie', () => {
    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p-tok' },
      secondary: { enabled: true, token: 's-tok' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    const queued = (window as any).mixpanel._i;
    const secondaryEntry = queued.find((e: any[]) => e[2] === 'secondary');
    expect(secondaryEntry).toBeTruthy();
    expect(secondaryEntry[1].persistence).toBe('localStorage');
  });

  it('deletes legacy `mp_<secondary_token>_mixpanel` cookie on secondary init', () => {
    // Seed a leftover cookie from the dual-cookie era.
    document.cookie = 'mp_s-tok_mixpanel=stale-blob; path=/';
    expect(document.cookie).toContain('mp_s-tok_mixpanel=stale-blob');

    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p-tok' },
      secondary: { enabled: true, token: 's-tok' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    expect(document.cookie).not.toContain('mp_s-tok_mixpanel=stale-blob');
  });

  it('legacy cookie sweep is a no-op when secondary cookie is absent (idempotent)', () => {
    // No mp_*_mixpanel cookie seeded.
    loadWithCommon('mixpanel');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p-tok' },
      secondary: { enabled: true, token: 's-tok' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    // No warning surface — sweep ran cleanly.
    const sweepWarn = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /deleteLegacyInstanceCookie failed/.test(String(c[1])),
    );
    expect(sweepWarn).toBeFalsy();
  });

  it('does NOT delete primary cookie (primary stays the persisted source)', () => {
    document.cookie = 'mp_p-tok_mixpanel=primary-state; path=/';

    loadWithCommon('mixpanel');
    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p-tok' },
      secondary: { enabled: true, token: 's-tok' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    expect(document.cookie).toContain('mp_p-tok_mixpanel=primary-state');
  });
});

describe('H4 — watchdog force-drain to ready instances', () => {
  it('drains buffered ops to a ready instance when the OTHER is stuck', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();

    // Buffer some events BEFORE either instance is ready.
    (window as any).ppLib.mixpanel.track('pre-init-1', { n: 1 });
    (window as any).ppLib.mixpanel.track('pre-init-2', { n: 2 });

    (window as any).ppLib.mixpanel.init();

    // Capture queued init entries BEFORE overwriting window.mixpanel.
    const queued = (window as any).mixpanel._i.slice();

    // Install a primary-only mock — NO `.secondary` child so the
    // auto-promotion path in dispatch.resolveMpRef can't find secondary
    // and secondary stays stuck (the failure mode the watchdog must
    // rescue).
    const primary = createMockMixpanel();
    (window as any).mixpanel = primary;

    // Fire ONLY primary's loaded callback. The orchestrator's
    // onInstanceLoaded runs identity sync (no-op since there's no
    // primary mpRef to copy from yet on first call), patches track,
    // sets state.initialized=true. The pre-init queue still won't
    // drain (drainIfReady gates on all-enabled-ready), so it stays
    // buffered until the watchdog.
    const primaryEntry = queued.find((e: any[]) => e[2] === undefined || e[2] === 'mixpanel');
    expect(primaryEntry).toBeTruthy();
    primaryEntry[1].loaded(primary);

    const logSpy = vi.spyOn(window.ppLib, 'log');

    // After patchInstanceTrack ran in onInstanceLoaded, `primary.track`
    // is a wrapper that forwards to the original vi.fn() spy via
    // `_ppOriginal`. Capture the spy so we can assert against the real
    // call list rather than the (un-spied) wrapper.
    const trackSpy = ((primary.track as any)._ppOriginal as ReturnType<typeof vi.fn>);

    // Advance past the 15s watchdog.
    vi.advanceTimersByTime(15001);

    // Both buffered tracks must have reached primary; secondary missed
    // them entirely (acceptable — that's the failure-mode contract).
    expect(trackSpy).toHaveBeenCalledWith(
      'pre-init-1',
      expect.objectContaining({ n: 1 }),
    );
    expect(trackSpy).toHaveBeenCalledWith(
      'pre-init-2',
      expect.objectContaining({ n: 2 }),
    );

    // Warn surfaced the stuck instance + the drained count.
    const watchdogWarn = logSpy.mock.calls.find(
      (c) =>
        c[0] === 'warn' &&
        /watchdog: secondary did not report loaded/.test(String(c[1])) &&
        /force-drained/.test(String(c[1])),
    );
    expect(watchdogWarn).toBeTruthy();
  });

  it('when NO instance is ready, buffered events are re-queued (not silently dropped) and a distinct warn fires', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();

    (window as any).ppLib.mixpanel.track('orphan-1');
    (window as any).ppLib.mixpanel.track('orphan-2');

    (window as any).ppLib.mixpanel.init();
    // Don't install any mp ref — both instances stay stuck.

    const logSpy = vi.spyOn(window.ppLib, 'log');
    vi.advanceTimersByTime(15001);

    // Distinct "no ready" warn fires so the operator knows the buffered
    // events did NOT make it out (vs the misleading "force-drained" log
    // the pre-fix code emitted in this scenario).
    const noReadyWarn = logSpy.mock.calls.find(
      (c) =>
        c[0] === 'warn' &&
        /watchdog: primary\+secondary did not report loaded/.test(String(c[1])) &&
        /no instance is ready/.test(String(c[1])) &&
        /buffered events remain queued/.test(String(c[1])),
    );
    expect(noReadyWarn).toBeTruthy();
  });

  // F15: a nothing-loaded watchdog must NOT latch allLoadedFired, so a late
  // `loaded` callback (instance recovers after the 15s timeout) can still run
  // onAllLoaded — otherwise shared context never registers and buffered events
  // stay stuck forever.
  it('recovers after a nothing-loaded watchdog: a late loaded still drains the buffer', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();

    (window as any).ppLib.mixpanel.track('orphan-1');
    (window as any).ppLib.mixpanel.track('orphan-2');

    (window as any).ppLib.mixpanel.init();
    const queued = (window as any).mixpanel._i.slice();

    // Watchdog fires with NOTHING loaded.
    vi.advanceTimersByTime(15001);

    // Both instances recover AFTER the watchdog.
    const { root, primary, secondary } = createDualMockMixpanel();
    (window as any).mixpanel = root;
    queued.forEach((entry: any[]) => {
      const [, opts, name] = entry;
      if (typeof opts.loaded === 'function') {
        opts.loaded(name === 'secondary' ? secondary : primary);
      }
    });

    // onAllLoaded ran on recovery → the buffered events drained to primary.
    // Pre-fix, the watchdog had latched allLoadedFired so onAllLoaded
    // early-returned and these were lost. (patchInstanceTrack wrapped
    // primary.track, so assert against the underlying spy via _ppOriginal.)
    const trackSpy = ((primary.track as any)._ppOriginal as ReturnType<typeof vi.fn>);
    const tracked = trackSpy.mock.calls.map((c: any[]) => c[0]);
    expect(tracked).toContain('orphan-1');
    expect(tracked).toContain('orphan-2');
  });

  it('clears the watchdog when all enabled instances load before the timeout', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    (window as any).ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();
    (window as any).ppLib.mixpanel.init();

    // Capture the loader-stub's queued `_i[]` BEFORE we overwrite
    // window.mixpanel with the dual mock. The real SDK does this in
    // reverse: it replaces the stub with the real implementation, then
    // replays the captured `_i[]`. We mirror that ordering.
    const queued = (window as any).mixpanel._i.slice();

    const { root, primary, secondary } = createDualMockMixpanel();
    (window as any).mixpanel = root;

    queued.forEach((entry: any[]) => {
      const [, opts, name] = entry;
      if (typeof opts.loaded === 'function') {
        const mp = name === 'secondary' ? secondary : primary;
        opts.loaded(mp);
      }
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    vi.advanceTimersByTime(15001);

    // Watchdog must NOT fire since both loaded.
    const watchdogWarn = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /watchdog:/.test(String(c[1])),
    );
    expect(watchdogWarn).toBeFalsy();
  });
});
