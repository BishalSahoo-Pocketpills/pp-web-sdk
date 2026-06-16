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
import type { MixpanelGlobal } from '@src/types/window';
import { loadWithCommon } from '../helpers/iife-loader.ts';
import {
  createDualMockMixpanel,
  createMockMixpanel,
  type MockMixpanel,
} from '../helpers/mock-mixpanel.ts';

/**
 * A queued `mp.init(token, opts, name)` entry on the loader stub's `_i[]`
 * array. The orchestrator installs its own `loaded` callback and pins
 * `persistence` per instance; tests read both back off the queued entry.
 */
interface StubInitOptions {
  loaded?: (mp: MockMixpanel) => void;
  persistence?: 'cookie' | 'localStorage';
  [key: string]: unknown;
}
type StubInitEntry = [token: string, options: StubInitOptions, instanceName?: string];

/** A vi mock function's recorded calls, narrowed to event-name-first args. */
type TrackCallArgs = [event: string, properties?: Record<string, unknown>];

/** Read the loader stub's queued `mp.init` entries. `_i` is a stub-internal
 *  property not present on the MixpanelGlobal type, so narrow via unknown. */
function stubQueue(): StubInitEntry[] {
  return (window.mixpanel as unknown as { _i: StubInitEntry[] })._i;
}

/** Install a mock as the live Mixpanel handle (mirrors the real SDK
 *  replacing the stub). MockMixpanel implements the surface the SDK calls. */
function setMixpanelHandle(mp: MockMixpanel): void {
  window.mixpanel = mp as unknown as MixpanelGlobal;
}

/** `patchInstanceTrack` replaces `mp.track` with a wrapper that forwards to
 *  the original spy stored on `_ppOriginal`. Recover it for call assertions. */
function originalTrackSpy(mp: MockMixpanel): ReturnType<typeof vi.fn> {
  return (mp.track as unknown as { _ppOriginal: ReturnType<typeof vi.fn> })._ppOriginal;
}

/** Event names recorded by a (possibly wrapped) track spy. */
function trackedEventNames(spy: ReturnType<typeof vi.fn>): string[] {
  return (spy.mock.calls as TrackCallArgs[]).map((call) => call[0]);
}

let insertBeforeSpy: ReturnType<typeof vi.spyOn> | null;

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
  Reflect.deleteProperty(window, 'mixpanel');
  delete window.ppLib;
  delete window.ppLibReady;
  Reflect.deleteProperty(window, '_enrichers');
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

    window.ppLib.mixpanel.configure({
      primary: {
        enabled: true,
        token: 'primary-tok',
        initOptions: { loaded: callerLoaded },
      },
    });

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    // The orchestrator's callback must still be installed on the stub queue.
    const queuedOpts = stubQueue()[0][1];
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

    window.ppLib.mixpanel.configure({
      primary: {
        enabled: true,
        token: 'primary-tok',
        initOptions: { [reservedKey]: 'caller-supplied-value' },
      },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const queuedOpts = stubQueue()[0][1];
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
    window.ppLib.mixpanel.configure({
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
    window.ppLib.mixpanel.init();

    const queuedOpts = stubQueue()[0][1];
    expect(queuedOpts.persistence_name).toBe('pp_custom');
    expect(queuedOpts.debug).toBe(true);
    expect(queuedOpts.property_blacklist).toEqual(['$current_url']);
  });

  it('reserved-key warning fires per-instance — secondary too', () => {
    loadWithCommon('mixpanel');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p', initOptions: { loaded: vi.fn() } },
      secondary: { enabled: true, token: 's', initOptions: { loaded: vi.fn() } },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const warnings = logSpy.mock.calls.filter(
      (c) => c[0] === 'warn' && /initOptions\.loaded is reserved/.test(String(c[1])),
    );
    // One warn per instance.
    expect(warnings.length).toBe(2);
  });
});

describe('Per-instance boot profile — persistence + cookie-size hardening', () => {
  it('primary inits with `persistence: "cookie"`', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const queued = stubQueue();
    const primaryEntry = queued.find(
      (e: StubInitEntry) => e[0] === 'ptok' && (e[2] === undefined || e[2] === 'mixpanel'),
    );
    expect(primaryEntry).toBeTruthy();
    expect(primaryEntry![1].persistence).toBe('cookie');
  });

  it('secondary inits with `persistence: "localStorage"` so only primary writes a cookie', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
      secondary: { enabled: true, token: 'stok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const queued = stubQueue();
    const secondaryEntry = queued.find((e: StubInitEntry) => e[2] === 'secondary');
    expect(secondaryEntry).toBeTruthy();
    expect(secondaryEntry![1].persistence).toBe('localStorage');
  });

  it('prunes the secondary project cookie (former dual-cookie era) on init', () => {
    // Seed a leftover cookie from the dual-cookie era.
    document.cookie = 'mp_stok_mixpanel=stale-blob; path=/';
    expect(document.cookie).toContain('mp_stok_mixpanel=stale-blob');

    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
      secondary: { enabled: true, token: 'stok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(document.cookie).not.toContain('mp_stok_mixpanel=stale-blob');
  });

  it('SWAP: prunes the OLD primary cookie when a NEW token becomes primary', () => {
    // Returning user arrives with the cookie written when OLD was primary.
    document.cookie = 'mp_oldtok_mixpanel=old-primary-state; path=/';
    // New release: NEW becomes primary, OLD moves to secondary (localStorage).
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'newtok' },
      secondary: { enabled: true, token: 'oldtok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    // The orphaned old-primary cookie is gone; only the new primary will
    // write its own cookie — no doubling that could blow the header limit.
    expect(document.cookie).not.toContain('mp_oldtok_mixpanel');
  });

  it('prunes an orphan even when secondary is disabled (primary-only deploy)', () => {
    // A token that is neither the current primary nor a configured secondary
    // — e.g. a fully-deprecated old project. Must still be swept.
    document.cookie = 'mp_ghosttok_mixpanel=ghost; path=/';
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(document.cookie).not.toContain('mp_ghosttok_mixpanel');
  });

  it('prune is silent when no orphan cookie is present (idempotent, no warn)', () => {
    loadWithCommon('mixpanel');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
      secondary: { enabled: true, token: 'stok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const pruneFail = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /Mixpanel cookie prune failed/.test(String(c[1])),
    );
    expect(pruneFail).toBeFalsy();
  });

  it('does NOT delete the current primary cookie (it stays the persisted source)', () => {
    document.cookie = 'mp_ptok_mixpanel=primary-state; path=/';

    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
      secondary: { enabled: true, token: 'stok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(document.cookie).toContain('mp_ptok_mixpanel=primary-state');
  });

  it('never touches non-Mixpanel cookies', () => {
    document.cookie = 'pp_segment=keep-me; path=/';
    document.cookie = 'mp_orphantok_mixpanel=drop-me; path=/';

    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'ptok' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(document.cookie).toContain('pp_segment=keep-me');
    expect(document.cookie).not.toContain('mp_orphantok_mixpanel');
  });
});

describe('Cookie-size telemetry', () => {
  // Fire a full boot so onAllLoaded() runs reportPrimaryCookieSize. The mock
  // SDK doesn't write the mp cookie itself, so we seed the primary cookie
  // under the primary token (the prune keeps it) to drive the measurement.
  // Returns the logSpy installed AFTER configure() but before the loaded
  // callback fires (so it captures the telemetry warn).
  function bootAndCaptureLog(primaryToken: string, shared?: Record<string, unknown>) {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: primaryToken },
      ...(shared ? { shared } : {}),
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();
    const logSpy = vi.spyOn(window.ppLib, 'log');
    const queued = stubQueue().slice();
    const primary = createMockMixpanel();
    setMixpanelHandle(primary);
    const entry = queued.find((e: StubInitEntry) => e[2] === undefined || e[2] === 'mixpanel');
    entry![1].loaded!(primary);
    return logSpy;
  }

  it('warns when the primary cookie exceeds the configured threshold', () => {
    // Seed an oversized primary cookie (token kept by the prune).
    document.cookie = 'mp_bigtok_mixpanel=' + 'x'.repeat(200) + '; path=/';
    const logSpy = bootAndCaptureLog('bigtok', {
      cookieSizeWarnBytes: { primary: 100, total: 1_000_000 },
    });

    const sizeWarn = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /cookie size over threshold/.test(String(c[1])),
    );
    expect(sizeWarn).toBeTruthy();
  });

  it('does NOT warn when cookies are within threshold', () => {
    document.cookie = 'mp_smalltok_mixpanel=tiny; path=/';
    const logSpy = bootAndCaptureLog('smalltok');

    const sizeWarn = logSpy.mock.calls.find(
      (c) => c[0] === 'warn' && /cookie size over threshold/.test(String(c[1])),
    );
    expect(sizeWarn).toBeFalsy();
  });
});

describe('H4 — watchdog force-drain to ready instances', () => {
  it('drains buffered ops to a ready instance when the OTHER is stuck', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();

    // Buffer some events BEFORE either instance is ready.
    window.ppLib.mixpanel.track('pre-init-1', { n: 1 });
    window.ppLib.mixpanel.track('pre-init-2', { n: 2 });

    window.ppLib.mixpanel.init();

    // Capture queued init entries BEFORE overwriting window.mixpanel.
    const queued = stubQueue().slice();

    // Install a primary-only mock — NO `.secondary` child so the
    // auto-promotion path in dispatch.resolveMpRef can't find secondary
    // and secondary stays stuck (the failure mode the watchdog must
    // rescue).
    const primary = createMockMixpanel();
    setMixpanelHandle(primary);

    // Fire ONLY primary's loaded callback. The orchestrator's
    // onInstanceLoaded runs identity sync (no-op since there's no
    // primary mpRef to copy from yet on first call), patches track,
    // sets state.initialized=true. The pre-init queue still won't
    // drain (drainIfReady gates on all-enabled-ready), so it stays
    // buffered until the watchdog.
    const primaryEntry = queued.find((e: StubInitEntry) => e[2] === undefined || e[2] === 'mixpanel');
    expect(primaryEntry).toBeTruthy();
    primaryEntry[1].loaded(primary);

    const logSpy = vi.spyOn(window.ppLib, 'log');

    // After patchInstanceTrack ran in onInstanceLoaded, `primary.track`
    // is a wrapper that forwards to the original vi.fn() spy via
    // `_ppOriginal`. Capture the spy so we can assert against the real
    // call list rather than the (un-spied) wrapper.
    const trackSpy = originalTrackSpy(primary);

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

    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();

    window.ppLib.mixpanel.track('orphan-1');
    window.ppLib.mixpanel.track('orphan-2');

    window.ppLib.mixpanel.init();
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

  it('clears the watchdog when all enabled instances load before the timeout', () => {
    vi.useFakeTimers();
    loadWithCommon('mixpanel');

    window.ppLib.mixpanel.configure({
      primary: { enabled: true, token: 'p' },
      secondary: { enabled: true, token: 's' },
    });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    // Capture the loader-stub's queued `_i[]` BEFORE we overwrite
    // window.mixpanel with the dual mock. The real SDK does this in
    // reverse: it replaces the stub with the real implementation, then
    // replays the captured `_i[]`. We mirror that ordering.
    const queued = stubQueue().slice();

    const { root, primary, secondary } = createDualMockMixpanel();
    setMixpanelHandle(root);

    queued.forEach((entry: StubInitEntry) => {
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
