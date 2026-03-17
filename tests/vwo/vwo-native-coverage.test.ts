/**
 * VWO Native Coverage Test
 *
 * Imports the VWO source directly through Vitest's transform pipeline instead
 * of loading the pre-built IIFE via vm.runInThisContext(). This bypasses the
 * ast-v8-to-istanbul conversion bug that produces negative branch counts when
 * processing esbuild IIFE output with inline source maps.
 *
 * All other VWO test files use { coverable: false } so their IIFE evaluations
 * don't contribute to src/vwo/index.ts coverage. This file is the sole source
 * of VWO coverage data.
 *
 * Common is loaded via IIFE (not native import) to avoid corrupting common's
 * coverage data through merge of IIFE + native V8 evaluations.
 */
import { loadModule } from '../helpers/iife-loader.ts';

async function freshLoad() {
  vi.resetModules();
  delete window.ppLib;
  delete window.ppLibReady;
  delete window._vwo_code;
  delete window._vwo_exp;
  delete window._vwo_settings_timer;
  delete window._vis_opt_queue;
  delete window._vis_opt_set_combination;
  delete (window as any).VWO;

  loadModule('common');
  await import('../../src/vwo/index.ts');
}

describe('VWO native coverage', () => {
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
    if (window._vwo_settings_timer) clearTimeout(window._vwo_settings_timer);
    delete (window as any).IntersectionObserver;
    delete window._vwo_exp;
    delete window._vwo_code;
    delete window._vwo_settings_timer;
    delete window._vis_opt_queue;
    delete window._vis_opt_set_combination;
    delete (window as any).VWO;
  });

  function setLocation(url: string) {
    delete (window as any).location;
    window.location = { ...originalLocation, href: url } as Location;
  }

  // ==========================================================================
  // HAPPY PATH — exercises the most branches in one evaluation
  // ==========================================================================
  it('happy path with forced variations, DOM goals, IO, and SmartCode', async () => {
    // URL with valid AND invalid pair → L62 true+false branches
    setLocation('https://example.com?vwo=42:2,bad,99:3');

    let observerCallback: IntersectionObserverCallback;
    const mockObserver = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    (window as any).IntersectionObserver = class {
      observe = mockObserver.observe;
      unobserve = mockObserver.unobserve;
      disconnect = mockObserver.disconnect;
      constructor(cb: IntersectionObserverCallback) { observerCallback = cb; }
    };

    document.body.innerHTML = `
      <button id="btn1" data-vwo-goal="100">Click</button>
      <button data-vwo-goal="200" data-vwo-revenue="49.99">Revenue</button>
      <button data-vwo-goal="xxx">Invalid goalId</button>
      <button data-vwo-goal="250" data-vwo-trigger="submit">Submit-trigger</button>
      <form data-vwo-goal="300" data-vwo-trigger="submit"><input type="submit"></form>
      <div data-vwo-goal="400" data-vwo-trigger="view">View</div>
      <div data-vwo-goal="500" data-vwo-trigger="view" data-vwo-revenue="9.99">View+Rev</div>
    `;

    await freshLoad();

    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'B' } },
      '99': { combination_chosen: 3, comb_n: { '3': 'C' } },
      '50': { combination_chosen: undefined, comb_n: {} },
    } as any;
    window._vis_opt_set_combination = vi.fn();
    const mockESConfigure = vi.fn();
    window.ppLib.eventSource = { configure: mockESConfigure } as any;
    window.ppLib.vwo!.configure({ accountId: '654321' });
    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) fn();
    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(2, 42);
    expect(window._vwo_code).toBeDefined();
    expect(impressionCount()).toBe(2);
    expect(mockESConfigure).toHaveBeenCalled();

    // DOM: click goals
    document.getElementById('btn1')!.click();
    document.querySelector('[data-vwo-revenue="49.99"]')!.dispatchEvent(new Event('click', { bubbles: true }));
    // click on submit-trigger → trigger !== 'click' → L335
    document.querySelector('[data-vwo-trigger="submit"]')!.dispatchEvent(new Event('click', { bubbles: true }));
    // click on invalid goalId → NaN check → L311
    document.querySelector('[data-vwo-goal="xxx"]')!.dispatchEvent(new Event('click', { bubbles: true }));

    // DOM: form submit
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    // IO: intersecting + not intersecting
    const viewEl = document.querySelector('[data-vwo-goal="400"]')!;
    observerCallback!([{ isIntersecting: true, target: viewEl } as IntersectionObserverEntry], {} as any);
    const viewEl2 = document.querySelector('[data-vwo-goal="500"]')!;
    observerCallback!([{ isIntersecting: false, target: viewEl2 } as IntersectionObserverEntry], {} as any);

    // API tests
    expect(window.ppLib.vwo!.getVariation('42')).toBe('2');
    expect(window.ppLib.vwo!.getVariation('nonexistent')).toBeNull();
    expect(window.ppLib.vwo!.getVariation('50')).toBeNull();
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(true);
    expect(window.ppLib.vwo!.isFeatureEnabled('nonexistent')).toBe(false);
    expect(window.ppLib.vwo!.getActiveExperiments().length).toBe(2);
    expect(window.ppLib.vwo!.getConfig().accountId).toBe('654321');

    // forceVariation
    window.ppLib.vwo!.forceVariation('77', '5');
    expect(JSON.parse(sessionStorage.getItem('pp_vwo_force')!)['77']).toBe('5');

    // trackGoal with and without revenue
    window.ppLib.vwo!.trackGoal(888);
    window.ppLib.vwo!.trackGoal(889, 19.99);

    // Re-scan (disconnect path) + SmartCode methods
    window.ppLib.vwo!.scanViewGoals();
    expect(mockObserver.disconnect).toHaveBeenCalled();
    window._vwo_code.code_loaded();
    expect(window._vwo_code.use_existing_jquery()).toBe(false);
    expect(window._vwo_code.library_tolerance()).toBe(2500);
    expect(window._vwo_code.finished()).toBe(false);
    window._vwo_code.finish();
    expect(window._vwo_code.finished()).toBe(true);
    window._vwo_code.finish(); // idempotent (f already true → L134 false branch)

    // No-goal elements
    document.body.innerHTML = '<div>No goal</div>';
    document.querySelector('div')!.click();
    document.body.innerHTML = '<form><button>Go</button></form>';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    // Delete IO → L367/368 guard; second init → L433 left branch of ||
    delete (window as any).IntersectionObserver;
    window.ppLib.vwo!.init();

    // Duplicate goal (same element within debounce window → L299/300)
    document.body.innerHTML = '<button id="dup" data-vwo-goal="600">Dup</button>';
    document.getElementById('dup')!.click();
    document.getElementById('dup')!.click(); // duplicate → isDuplicateGoal returns true

    // Element with empty goal attr → L307/308
    document.body.innerHTML = '<button data-vwo-goal="">Empty</button>';
    document.querySelector('button')!.click();

    // Revenue that is NaN → L320
    document.body.innerHTML = '<button data-vwo-goal="700" data-vwo-revenue="abc">Bad Rev</button>';
    document.querySelector('button')!.click();

    function impressionCount() {
      return window.dataLayer!.filter((e: any) => e.event === 'experiment_impression').length;
    }
  });

  // ==========================================================================
  // GUARD PATHS
  // ==========================================================================
  it('disabled, no accountId, existing _vwo_code, configure() no args', async () => {
    await freshLoad();

    window.ppLib.vwo!.configure({ enabled: false });
    window.ppLib.vwo!.init();

    window.ppLib.vwo!.configure({ enabled: true, accountId: '' });
    window.ppLib.vwo!.init();

    expect(window.ppLib.vwo!.configure()).toBeDefined();

    window._vwo_code = { init: vi.fn(), finish: vi.fn(), finished: () => false } as any;
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    delete window._vwo_code;
  });

  it('no experiments, trackToDataLayer=false', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123', trackToDataLayer: false });
    window.ppLib.vwo!.init();
    for (const fn of window._vis_opt_queue) fn();

    expect(window.ppLib.vwo!.getVariation('any')).toBeNull();
    expect(window.ppLib.vwo!.isFeatureEnabled('any')).toBe(false);
    expect(window.ppLib.vwo!.getActiveExperiments()).toEqual([]);
  });

  it('sessionStorage fallback for forced variations', async () => {
    sessionStorage.setItem('pp_vwo_force', JSON.stringify({ '10': '3' }));
    await freshLoad();
    window._vis_opt_set_combination = vi.fn();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    for (const fn of window._vis_opt_queue) fn();
    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(3, 10);
  });

  it('parseForcedVariations catch on getQueryParam error', async () => {
    await freshLoad();
    window.ppLib.getQueryParam = () => { throw new Error('test'); };
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
  });

  it('scanViewGoals without IntersectionObserver', async () => {
    delete (window as any).IntersectionObserver;
    document.body.innerHTML = '<div data-vwo-goal="100" data-vwo-trigger="view">V</div>';
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
  });

  it('isFeatureEnabled: control variation 1 returns false', async () => {
    await freshLoad();
    window._vwo_exp = { '10': { combination_chosen: 1, comb_n: {} } } as any;
    expect(window.ppLib.vwo!.isFeatureEnabled('10')).toBe(false);
  });

  // ==========================================================================
  // ERROR / CATCH PATHS
  // ==========================================================================
  it('sessionStorage write and read errors', async () => {
    await freshLoad();

    // Make sessionStorage.setItem throw → L31 catch
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    window.ppLib.vwo!.forceVariation('1', '2'); // calls sessionStorageSet
    vi.mocked(Storage.prototype.setItem).mockRestore();

    // Make sessionStorage.getItem throw → L39-40 catch
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('access'); });
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init(); // parseForcedVariations calls sessionStorageGet
    vi.mocked(Storage.prototype.getItem).mockRestore();
  });

  it('readExperiments catch', async () => {
    await freshLoad();
    // Make _vwo_exp a getter that throws → L228
    Object.defineProperty(window, '_vwo_exp', {
      get: () => { throw new Error('boom'); },
      configurable: true
    });
    expect(window.ppLib.vwo!.getActiveExperiments()).toEqual([]);
    delete window._vwo_exp;
  });

  it('trackGoal catch', async () => {
    await freshLoad();
    // Make VWO.push throw → L277
    window.VWO = { push: () => { throw new Error('fail'); } } as any;
    window.ppLib.vwo!.trackGoal(999);
  });

  it('getVariation catch', async () => {
    await freshLoad();
    Object.defineProperty(window, '_vwo_exp', {
      get: () => { throw new Error('boom'); },
      configurable: true
    });
    expect(window.ppLib.vwo!.getVariation('1')).toBeNull();
    delete window._vwo_exp;
  });

  it('isFeatureEnabled catch', async () => {
    await freshLoad();
    Object.defineProperty(window, '_vwo_exp', {
      get: () => { throw new Error('boom'); },
      configurable: true
    });
    expect(window.ppLib.vwo!.isFeatureEnabled('1')).toBe(false);
    delete window._vwo_exp;
  });

  it('forceVariation catch', async () => {
    await freshLoad();
    // Make _vis_opt_queue.push throw to trigger forceVariation's outer catch (L492)
    window._vis_opt_queue = { push: () => { throw new Error('fail'); } } as any;
    window.ppLib.vwo!.forceVariation('1', '2');
  });

  it('handleGoalClick catch', async () => {
    await freshLoad();
    document.body.innerHTML = '<button data-vwo-goal="100">X</button>';
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    // Override closest to throw → L339
    const btn = document.querySelector('button')!;
    btn.closest = () => { throw new Error('boom'); };
    btn.click();
  });

  it('handleGoalSubmit catch', async () => {
    await freshLoad();
    document.body.innerHTML = '<form data-vwo-goal="100" data-vwo-trigger="submit"><input></form>';
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    const form = document.querySelector('form')!;
    // Override hasAttribute to throw → L361
    form.hasAttribute = () => { throw new Error('boom'); };
    form.dispatchEvent(new Event('submit', { bubbles: true }));
  });

  it('scanViewGoals catch', async () => {
    await freshLoad();
    document.body.innerHTML = '<div data-vwo-goal="100" data-vwo-trigger="view">V</div>';
    // IO constructor throws → L396
    (window as any).IntersectionObserver = class {
      constructor() { throw new Error('not supported'); }
    };
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
  });

  // ==========================================================================
  // DEBOUNCE PRUNING (100+ writes → L291-295)
  // ==========================================================================
  it('debounce map pruning — stale entries deleted', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123', debounceMs: 0 });
    window.ppLib.vwo!.init();

    // debounceMs=0 → all entries stale → L294 true branch, L295 delete
    for (let i = 0; i < 101; i++) {
      document.body.innerHTML = `<button data-vwo-goal="${1000 + i}">G${i}</button>`;
      document.querySelector('button')!.click();
    }
  });

  it('debounce map pruning — recent entries kept', async () => {
    await freshLoad();
    // Default debounceMs (300ms) → entries created within 300ms are kept → L294 false branch
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    for (let i = 0; i < 101; i++) {
      document.body.innerHTML = `<button data-vwo-goal="${2000 + i}">G${i}</button>`;
      document.querySelector('button')!.click();
    }
  });

  // ==========================================================================
  // SMARTCODE EDGE CASES
  // ==========================================================================
  it('SmartCode with isSPA=true and no hideElement', async () => {
    await freshLoad();
    // L125 isSPA truthy branch, L159 hideElement falsy branch
    window.ppLib.vwo!.configure({ accountId: '123', isSPA: true, hideElement: '' });
    window.ppLib.vwo!.init();
  });

  it('SmartCode finish when element has no parentNode', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    // Remove the style element so finish() can't find it → L137 false branch
    const style = document.getElementById('_vis_opt_path_hides');
    if (style) style.remove();
    window._vwo_code.finished = () => false;
    // Reset f flag by creating new smart code scenario
    // Actually, _vwo_code.finish() checks `f` flag first
    // We need a fresh _vwo_code where f=false but element doesn't exist
    // The existing _vwo_code has f=false on first call
    window._vwo_code.finish();
  });

  it('SmartCode script onerror and settings timer callbacks', async () => {
    vi.useFakeTimers();
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123', settingsTolerance: 100 });
    window.ppLib.vwo!.init();

    // Find the script element and trigger onerror → L149
    const scripts = document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]');
    for (const s of scripts) {
      if ((s as HTMLScriptElement).onerror) {
        (s as HTMLScriptElement).onerror!(new Event('error'));
      }
    }

    // Fire the settings timer callback → L155 (win._vwo_code.finish())
    vi.advanceTimersByTime(200);

    // Clear the timer so afterEach doesn't try to clear an already-fired timer
    delete window._vwo_settings_timer;
    vi.useRealTimers();
  });

  // ==========================================================================
  // SUBMIT HANDLER EDGE CASES
  // ==========================================================================
  it('handleGoalSubmit: closest fallback + trigger mismatch', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Submit on element without hasAttribute → L349 false → closest fallback (L351 true)
    // Wrapper has goal with trigger=click → trigger !== 'submit' → return
    document.body.innerHTML = '<div data-vwo-goal="100" data-vwo-trigger="click"><form id="f1"></form></div>';
    const form1 = document.getElementById('f1')!;
    Object.defineProperty(form1, 'hasAttribute', { value: undefined, configurable: true });
    form1.dispatchEvent(new Event('submit', { bubbles: true }));

    // Closest path, wrapper has NO trigger attr → getAttribute returns null → L356 || right branch
    document.body.innerHTML = '<div data-vwo-goal="200"><form id="f2"></form></div>';
    const form2 = document.getElementById('f2')!;
    Object.defineProperty(form2, 'hasAttribute', { value: undefined, configurable: true });
    form2.dispatchEvent(new Event('submit', { bubbles: true }));

    // Neither hasAttribute nor closest → L351 false → el stays null → L354 return
    document.body.innerHTML = '<form id="f3"></form>';
    const form3 = document.getElementById('f3')!;
    Object.defineProperty(form3, 'hasAttribute', { value: undefined, configurable: true });
    Object.defineProperty(form3, 'closest', { value: undefined, configurable: true });
    form3.dispatchEvent(new Event('submit', { bubbles: true }));
  });

  it('handleGoalClick: target without closest', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Dispatch click with a target that has no closest method → L329
    const evt = new Event('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: { closest: undefined } });
    document.dispatchEvent(evt);
  });

  it('handleGoalSubmit: null form target', async () => {
    await freshLoad();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Dispatch submit with null target → L346
    const evt = new Event('submit', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: null });
    document.dispatchEvent(evt);
  });

  it('scanViewGoals with no view elements', async () => {
    await freshLoad();
    document.body.innerHTML = '<div>no view goals</div>';
    (window as any).IntersectionObserver = class {
      observe = vi.fn();
      constructor(cb: IntersectionObserverCallback) {}
    };
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();
    // scanViewGoals finds 0 elements → L374 early return
  });

  it('experiment with no comb_n entry', async () => {
    await freshLoad();
    window._vwo_exp = {
      '1': { combination_chosen: 2, comb_n: { '9': 'X' } }, // variationId '2' not in comb_n → L217 false
    } as any;
    window.ppLib.vwo!.configure({ accountId: '123', trackToDataLayer: true });
    window.ppLib.vwo!.init();
    for (const fn of window._vis_opt_queue) fn();
    const exps = window.ppLib.vwo!.getActiveExperiments();
    expect(exps[0].variationName).toBe('');
  });

  it('isFeatureEnabled: combination_chosen falsy', async () => {
    await freshLoad();
    window._vwo_exp = { '10': { combination_chosen: 0, comb_n: {} } } as any;
    expect(window.ppLib.vwo!.isFeatureEnabled('10')).toBe(false); // L508
  });

  // ==========================================================================
  // IIFE BOOTSTRAP DEFERRED PATH
  // ==========================================================================
  it('deferred load: VWO before common', async () => {
    delete window.ppLib;
    delete window.ppLibReady;
    vi.resetModules();
    await import('../../src/vwo/index.ts');
    expect(window.ppLibReady!.length).toBe(1);
    loadModule('common');
    expect(window.ppLib.vwo).toBeDefined();
  });

  // ==========================================================================
  // forceVariation with no existing queue → L487 right branch
  // ==========================================================================
  it('forceVariation when _vis_opt_queue is undefined', async () => {
    await freshLoad();
    delete window._vis_opt_queue;
    window.ppLib.vwo!.forceVariation('5', '2');
    expect(window._vis_opt_queue).toBeDefined();
  });
});
