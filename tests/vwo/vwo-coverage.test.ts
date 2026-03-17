/**
 * VWO Coverage Tests — runs in a separate worker process (pool: 'forks')
 * to ensure V8 coverage is accurately tracked with minimal IIFE re-evaluations.
 *
 * Each test exercises many branches in a single module evaluation,
 * compensating for V8's coverage-merge limitations across repeated
 * vm.runInThisContext() calls in the main test file.
 */
import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';

// =========================================================================
// FULL BRANCH COVERAGE — HAPPY PATH
// =========================================================================
describe('VWO coverage — happy path', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true
    });
    delete (window as any).IntersectionObserver;
    delete window._vwo_exp;
  });

  function setLocation(url: string) {
    delete (window as any).location;
    window.location = { ...originalLocation, href: url } as Location;
  }

  it('exercises all happy-path branches in one evaluation', () => {
    // --- Setup: forced variation via URL, experiments, DOM, IntersectionObserver ---
    setLocation('https://example.com?vwo=42:2,99:3');

    let observerCallback: IntersectionObserverCallback;
    const mockObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };
    (window as any).IntersectionObserver = class {
      observe = mockObserver.observe;
      unobserve = mockObserver.unobserve;
      disconnect = mockObserver.disconnect;
      constructor(cb: IntersectionObserverCallback) { observerCallback = cb; }
    };

    document.body.innerHTML = `
      <button id="btn1" data-vwo-goal="100">Click</button>
      <button data-vwo-goal="200" data-vwo-revenue="49.99">Revenue</button>
      <button data-vwo-goal="xxx">Invalid</button>
      <button data-vwo-goal="250" data-vwo-trigger="submit">Submit-trigger</button>
      <form data-vwo-goal="300" data-vwo-trigger="submit"><input type="submit"></form>
      <div data-vwo-goal="400" data-vwo-trigger="view">View</div>
      <div data-vwo-goal="500" data-vwo-trigger="view" data-vwo-revenue="9.99">View+Rev</div>
    `;

    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'B' } },
      '99': { combination_chosen: 3, comb_n: { '3': 'C' } },
      '50': { combination_chosen: undefined, comb_n: {} },
    } as any;

    window._vis_opt_set_combination = vi.fn();
    const mockESConfigure = vi.fn();

    // --- Load and init ---
    loadWithCommon('vwo', { coverable: false });
    window.ppLib.eventSource = { configure: mockESConfigure } as any;
    window.ppLib.vwo!.configure({ accountId: '654321' });
    window.ppLib.vwo!.init();

    // --- Execute queued functions ---
    for (const fn of window._vis_opt_queue) fn();

    // Verify forced variations executed
    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(2, 42);
    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(3, 99);

    // Verify SmartCode
    expect(window._vwo_code).toBeDefined();
    expect(document.getElementById('_vis_opt_path_hides')).not.toBeNull();

    // Verify experiment tracking
    const impressions = window.dataLayer!.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(2);

    // Verify event-source auto-enable
    expect(mockESConfigure).toHaveBeenCalled();

    // DOM: click goal
    document.getElementById('btn1')!.click();
    expect(window.VWO).toBeDefined();

    // DOM: click with revenue
    document.querySelector('[data-vwo-revenue="49.99"]')!.dispatchEvent(new Event('click', { bubbles: true }));

    // DOM: click on submit-trigger element → ignored
    document.querySelector('[data-vwo-trigger="submit"]')!.dispatchEvent(new Event('click', { bubbles: true }));

    // DOM: form submit
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    // DOM: IntersectionObserver callback — intersecting
    const viewEl = document.querySelector('[data-vwo-goal="400"]')!;
    observerCallback!([{ isIntersecting: true, target: viewEl } as IntersectionObserverEntry], {} as any);
    expect(mockObserver.unobserve).toHaveBeenCalledWith(viewEl);

    // DOM: IntersectionObserver callback — NOT intersecting
    const viewEl2 = document.querySelector('[data-vwo-goal="500"]')!;
    observerCallback!([{ isIntersecting: false, target: viewEl2 } as IntersectionObserverEntry], {} as any);

    // API: getVariation
    expect(window.ppLib.vwo!.getVariation('42')).toBe('2');
    expect(window.ppLib.vwo!.getVariation('nonexistent')).toBeNull();
    expect(window.ppLib.vwo!.getVariation('50')).toBeNull(); // no combination_chosen

    // API: isFeatureEnabled
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(true);
    expect(window.ppLib.vwo!.isFeatureEnabled('nonexistent')).toBe(false);

    // API: getActiveExperiments
    expect(window.ppLib.vwo!.getActiveExperiments().length).toBe(2);

    // API: getConfig
    expect(window.ppLib.vwo!.getConfig().accountId).toBe('654321');

    // API: forceVariation (programmatic)
    window.ppLib.vwo!.forceVariation('77', '5');
    const stored = JSON.parse(sessionStorage.getItem('pp_vwo_force')!);
    expect(stored['77']).toBe('5');

    // API: trackGoal (with and without revenue)
    window.ppLib.vwo!.trackGoal(888);
    window.ppLib.vwo!.trackGoal(889, 19.99);

    // Re-scan view goals (exercises disconnect path)
    window.ppLib.vwo!.scanViewGoals();
    expect(mockObserver.disconnect).toHaveBeenCalled();

    // SmartCode: finish, finished, code_loaded, use_existing_jquery, library_tolerance
    window._vwo_code.code_loaded();
    expect(window._vwo_code.use_existing_jquery()).toBe(false);
    expect(window._vwo_code.library_tolerance()).toBe(2500);
    expect(window._vwo_code.finished()).toBe(false);
    window._vwo_code.finish();
    expect(window._vwo_code.finished()).toBe(true);
    window._vwo_code.finish(); // idempotent

    // Click on element without data-vwo-goal → no effect
    document.body.innerHTML = '<div>No goal</div>';
    document.querySelector('div')!.click();

    // Submit on form without goal → no effect
    document.body.innerHTML = '<form><button>Go</button></form>';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    // --- Exercise remaining V8 branches in the SAME evaluation ---
    // URL with invalid pair format → L62 if-condition FALSE branch (parts.length !== 2)
    setLocation('https://example.com?vwo=bad');
    // Delete IntersectionObserver so L368's guard branch is taken
    delete (window as any).IntersectionObserver;
    // Call init() again: _vis_opt_queue exists → L433 || takes left branch
    // bindDOM() → scanViewGoals() → IntersectionObserver guard → L368 covered
    window.ppLib.vwo!.init();
  });
});

// =========================================================================
// FULL BRANCH COVERAGE — GUARD & ERROR PATHS
// =========================================================================
describe('VWO coverage — guard paths', () => {
  it('disabled guard + no accountId guard + existing _vwo_code', () => {
    loadWithCommon('vwo', { coverable: false });
    const logSpy = vi.spyOn(window.ppLib, 'log');

    // Disabled
    window.ppLib.vwo!.configure({ enabled: false });
    window.ppLib.vwo!.init();
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('disabled'));

    // No accountId
    window.ppLib.vwo!.configure({ enabled: true, accountId: '' });
    window.ppLib.vwo!.init();
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No accountId'));

    // configure() with no args
    expect(window.ppLib.vwo!.configure()).toBeDefined();

    // Existing _vwo_code
    window._vwo_code = { init: vi.fn(), finish: vi.fn(), finished: () => false } as any;
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('already present'));

    delete window._vwo_code;
  });

  it('no forced variations, no experiments, trackToDataLayer=false', () => {
    loadWithCommon('vwo', { coverable: false });
    window.ppLib.vwo!.configure({ accountId: '123', trackToDataLayer: false });
    window.ppLib.vwo!.init();

    // Execute queue — trackExperiments should skip due to trackToDataLayer=false
    for (const fn of window._vis_opt_queue) fn();

    expect(window.ppLib.vwo!.getVariation('any')).toBeNull();
    expect(window.ppLib.vwo!.isFeatureEnabled('any')).toBe(false);
    expect(window.ppLib.vwo!.getActiveExperiments()).toEqual([]);
  });

  it('parseForcedVariations falls back to sessionStorage', () => {
    sessionStorage.setItem('pp_vwo_force', JSON.stringify({ '10': '3' }));

    loadWithCommon('vwo', { coverable: false });
    window._vis_opt_set_combination = vi.fn();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) fn();
    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(3, 10);
  });

  it('parseForcedVariations outer catch on getQueryParam error', () => {
    loadWithCommon('vwo', { coverable: false });
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.getQueryParam = () => { throw new Error('test'); };
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('error', '[ppVWO] parseForcedVariations error', expect.any(Error));
  });

  it('scanViewGoals without IntersectionObserver', () => {
    delete (window as any).IntersectionObserver;
    document.body.innerHTML = '<div data-vwo-goal="100" data-vwo-trigger="view">V</div>';

    loadWithCommon('vwo', { coverable: false });
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('IntersectionObserver not available'));
  });

  it('isFeatureEnabled returns false for control (variation 1)', () => {
    loadWithCommon('vwo', { coverable: false });
    window._vwo_exp = { '10': { combination_chosen: 1, comb_n: {} } } as any;
    expect(window.ppLib.vwo!.isFeatureEnabled('10')).toBe(false);
    delete window._vwo_exp;
  });

  it('IIFE bootstrap deferred path', () => {
    delete window.ppLib;
    delete window.ppLibReady;
    loadModule('vwo', { coverable: false });
    expect(window.ppLibReady!.length).toBe(1);
    loadModule('common');
    expect(window.ppLib.vwo).toBeDefined();
  });
});
