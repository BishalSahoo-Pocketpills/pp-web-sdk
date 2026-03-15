import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { createMockDataLayer } from '../helpers/mock-datalayer.ts';

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('vwo');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.vwo).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('vwo');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady!.length).toBe(1);
    expect(typeof window.ppLibReady![0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('vwo');
    expect(window.ppLibReady!.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.vwo).toBeDefined();
  });

  it('exposes ppLib.vwo public API with all expected methods', () => {
    loadWithCommon('vwo');
    const api = window.ppLib.vwo!;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.getVariation).toBe('function');
    expect(typeof api.getActiveExperiments).toBe('function');
    expect(typeof api.forceVariation).toBe('function');
    expect(typeof api.trackGoal).toBe('function');
    expect(typeof api.bindDOM).toBe('function');
    expect(typeof api.scanViewGoals).toBe('function');
    expect(typeof api.isFeatureEnabled).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});

// =========================================================================
// 2. CONFIG DEFAULTS
// =========================================================================
describe('Config Defaults', () => {
  it('returns correct default values', () => {
    loadWithCommon('vwo');
    const config = window.ppLib.vwo!.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.accountId).toBe('');
    expect(config.settingsTolerance).toBe(2000);
    expect(config.libraryTolerance).toBe(2500);
    expect(config.isSPA).toBe(false);
    expect(config.hideElement).toBe('body');
    expect(config.queryParam).toBe('vwo');
    expect(config.sessionStorageKey).toBe('pp_vwo_force');
    expect(config.trackToDataLayer).toBe(true);
    expect(config.attributes.goal).toBe('data-vwo-goal');
    expect(config.attributes.revenue).toBe('data-vwo-revenue');
    expect(config.attributes.trigger).toBe('data-vwo-trigger');
    expect(config.debounceMs).toBe(300);
  });
});

// =========================================================================
// 3. configure()
// =========================================================================
describe('configure()', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('merges partial config', () => {
    const config = window.ppLib.vwo!.configure({ accountId: '123456' });
    expect(config.accountId).toBe('123456');
    expect(config.enabled).toBe(true);
  });

  it('returns config when called with no args', () => {
    const config = window.ppLib.vwo!.configure();
    expect(config).toBeDefined();
    expect(config.accountId).toBe('');
  });

  it('merges multiple options', () => {
    window.ppLib.vwo!.configure({ accountId: '111', settingsTolerance: 3000 });
    const config = window.ppLib.vwo!.getConfig();
    expect(config.accountId).toBe('111');
    expect(config.settingsTolerance).toBe(3000);
  });

  it('overrides defaults with configure()', () => {
    const config = window.ppLib.vwo!.configure({
      enabled: false,
      isSPA: true,
      hideElement: '#main',
      queryParam: 'test',
      sessionStorageKey: 'test_key',
      trackToDataLayer: false
    });
    expect(config.enabled).toBe(false);
    expect(config.isSPA).toBe(true);
    expect(config.hideElement).toBe('#main');
    expect(config.queryParam).toBe('test');
    expect(config.sessionStorageKey).toBe('test_key');
    expect(config.trackToDataLayer).toBe(false);
  });
});

// =========================================================================
// 4. init() GUARDS
// =========================================================================
describe('init() guards', () => {
  it('logs and returns when module is disabled', () => {
    loadWithCommon('vwo');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.vwo!.configure({ enabled: false, accountId: '123' });
    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Module disabled'));
  });

  it('logs warning and returns when accountId is empty', () => {
    loadWithCommon('vwo');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No accountId'));
  });

  it('does not inject script when disabled', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ enabled: false });
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]');
    expect(scripts.length).toBe(0);
  });

  it('does not inject script when accountId missing', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]');
    expect(scripts.length).toBe(0);
  });

  it('skips injection when _vwo_code already exists (inline SmartCode)', () => {
    loadWithCommon('vwo');

    // Simulate inline SmartCode already present
    window._vwo_code = {
      finish: vi.fn(),
      finished: vi.fn(() => false),
      init: vi.fn(),
      load: vi.fn(),
      library_tolerance: vi.fn(() => 2500),
      use_existing_jquery: vi.fn(() => false),
      code_loaded: vi.fn()
    };

    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.configure({ accountId: '999' });
    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('already present'));

    // Should not inject a second script
    const scripts = document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]');
    expect(scripts.length).toBe(0);
  });

  it('allows init without accountId when _vwo_code already exists', () => {
    loadWithCommon('vwo');

    window._vwo_code = {
      finish: vi.fn(),
      finished: vi.fn(() => false),
      init: vi.fn(),
      load: vi.fn(),
      library_tolerance: vi.fn(() => 2500),
      use_existing_jquery: vi.fn(() => false),
      code_loaded: vi.fn()
    };

    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.init();

    // Should NOT warn about missing accountId
    const warnCalls = logSpy.mock.calls.filter(c => c[0] === 'warn' && String(c[1]).includes('No accountId'));
    expect(warnCalls.length).toBe(0);

    // Should still initialize
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Initialized'));
  });
});

// =========================================================================
// 5. SMARTCODE INJECTION
// =========================================================================
describe('SmartCode injection', () => {
  beforeEach(() => {
    // Clean VWO artifacts from document.head (setup.ts only clears body)
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '654321' });
  });

  it('injects anti-FOUC style element', () => {
    window.ppLib.vwo!.init();

    const style = document.getElementById('_vis_opt_path_hides');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('opacity:0');
  });

  it('injects VWO script with correct account ID', () => {
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript).toBeDefined();
    expect(vwoScript!.src).toContain('a=654321');
  });

  it('sets window._vwo_code object', () => {
    window.ppLib.vwo!.init();

    expect(window._vwo_code).toBeDefined();
    expect(typeof window._vwo_code.finish).toBe('function');
    expect(typeof window._vwo_code.finished).toBe('function');
    expect(typeof window._vwo_code.load).toBe('function');
    expect(typeof window._vwo_code.init).toBe('function');
    expect(typeof window._vwo_code.library_tolerance).toBe('function');
    expect(typeof window._vwo_code.use_existing_jquery).toBe('function');
    expect(typeof window._vwo_code.code_loaded).toBe('function');
  });

  it('sets window._vwo_settings_timer', () => {
    window.ppLib.vwo!.init();
    expect(window._vwo_settings_timer).toBeDefined();
  });

  it('use_existing_jquery returns false', () => {
    window.ppLib.vwo!.init();
    expect(window._vwo_code.use_existing_jquery()).toBe(false);
  });

  it('library_tolerance returns configured value', () => {
    window.ppLib.vwo!.init();
    expect(window._vwo_code.library_tolerance()).toBe(2500);
  });

  it('custom hideElement is used in anti-FOUC style', () => {
    window.ppLib.vwo!.configure({ hideElement: '#content' });
    window.ppLib.vwo!.init();

    const style = document.getElementById('_vis_opt_path_hides');
    expect(style!.textContent).toContain('#content');
  });

  it('loads script with isSPA flag when configured', () => {
    window.ppLib.vwo!.configure({ isSPA: true });
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript!.src).toContain('f=1');
  });

  it('includes f=0 when isSPA is false', () => {
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript!.src).toContain('f=0');
  });

  it('finish() removes anti-FOUC style when not SPA', () => {
    window.ppLib.vwo!.init();

    const styleBefore = document.getElementById('_vis_opt_path_hides');
    expect(styleBefore).not.toBeNull();

    window._vwo_code.finish();

    const styleAfter = document.getElementById('_vis_opt_path_hides');
    expect(styleAfter).toBeNull();
  });

  it('finish() is idempotent — second call is a no-op', () => {
    window.ppLib.vwo!.init();

    window._vwo_code.finish();
    expect(document.getElementById('_vis_opt_path_hides')).toBeNull();
    expect(window._vwo_code.finished()).toBe(true);

    // Second call should not throw
    window._vwo_code.finish();
    expect(window._vwo_code.finished()).toBe(true);
  });

  it('timeout removes anti-FOUC style if VWO does not load', () => {
    vi.useFakeTimers();
    window.ppLib.vwo!.init();

    const styleBefore = document.getElementById('_vis_opt_path_hides');
    expect(styleBefore).not.toBeNull();

    vi.advanceTimersByTime(2000);

    const styleAfter = document.getElementById('_vis_opt_path_hides');
    expect(styleAfter).toBeNull();

    vi.useRealTimers();
  });

  it('timeout calls finish() which is safe after manual finish()', () => {
    vi.useFakeTimers();
    window.ppLib.vwo!.init();

    // Manual finish() first
    window._vwo_code.finish();
    expect(window._vwo_code.finished()).toBe(true);

    // Timeout fires but finish() is idempotent — no error
    vi.advanceTimersByTime(2000);
    expect(window._vwo_code.finished()).toBe(true);

    vi.useRealTimers();
  });

  it('_vwo_code.load() injects a script tag', () => {
    window.ppLib.vwo!.init();

    const scriptCountBefore = document.querySelectorAll('script').length;
    window._vwo_code.load('https://example.com/test.js');
    const scriptCountAfter = document.querySelectorAll('script').length;

    expect(scriptCountAfter).toBe(scriptCountBefore + 1);
    const lastScript = document.querySelectorAll('script')[scriptCountAfter - 1];
    expect(lastScript.src).toContain('example.com/test.js');
  });

  it('sets up _vis_opt_queue for experiment tracking', () => {
    window.ppLib.vwo!.init();

    expect(window._vis_opt_queue).toBeDefined();
    expect(Array.isArray(window._vis_opt_queue)).toBe(true);
    expect(window._vis_opt_queue.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================================
// 6. QUERY PARAM FORCING
// =========================================================================
describe('Query param forcing', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
  });

  afterEach(() => {
    // Restore location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true
    });
  });

  function setLocation(url: string) {
    delete (window as any).location;
    window.location = { ...originalLocation, href: url } as Location;
  }

  it('parses ?vwo=42:2 from URL and stores in sessionStorage', () => {
    setLocation('https://example.com?vwo=42:2');
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    const stored = sessionStorage.getItem('pp_vwo_force');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['42']).toBe('2');
  });

  it('parses multiple forced variations: ?vwo=42:2,99:3', () => {
    setLocation('https://example.com?vwo=42:2,99:3');
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    const stored = sessionStorage.getItem('pp_vwo_force');
    const parsed = JSON.parse(stored!);
    expect(parsed['42']).toBe('2');
    expect(parsed['99']).toBe('3');
  });

  it('reads forced variations from sessionStorage when no URL param', () => {
    sessionStorage.setItem('pp_vwo_force', JSON.stringify({ '10': '3' }));

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Should have pushed to _vis_opt_queue
    expect(window._vis_opt_queue).toBeDefined();
    expect(window._vis_opt_queue.length).toBeGreaterThanOrEqual(1);
  });

  it('pushes _vis_opt_set_combination to queue for forced variations', () => {
    setLocation('https://example.com?vwo=42:2');
    loadWithCommon('vwo');

    window._vis_opt_set_combination = vi.fn();
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Execute the queued functions
    for (const fn of window._vis_opt_queue) {
      fn();
    }

    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(2, 42);
  });

  it('uses custom queryParam name', () => {
    setLocation('https://example.com?ab_test=55:1');
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123', queryParam: 'ab_test' });
    window.ppLib.vwo!.init();

    const stored = sessionStorage.getItem('pp_vwo_force');
    const parsed = JSON.parse(stored!);
    expect(parsed['55']).toBe('1');
  });

  it('uses custom sessionStorageKey', () => {
    setLocation('https://example.com?vwo=10:1');
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123', sessionStorageKey: 'custom_key' });
    window.ppLib.vwo!.init();

    const stored = sessionStorage.getItem('custom_key');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['10']).toBe('1');
  });

  it('no forced variations when URL param is absent and sessionStorage is empty', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    // Queue should only have trackExperiments, not forced variation calls
    // The last item in _vis_opt_queue is trackExperiments
    expect(window._vis_opt_queue).toBeDefined();
  });
});

// =========================================================================
// 7. EXPERIMENT READING
// =========================================================================
describe('Experiment reading', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('returns empty array when _vwo_exp is not set', () => {
    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments).toEqual([]);
  });

  it('returns empty array when _vwo_exp is empty object', () => {
    window._vwo_exp = {};
    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments).toEqual([]);
  });

  it('reads active experiments with variation names', () => {
    window._vwo_exp = {
      '42': {
        combination_chosen: 2,
        comb_n: { '1': 'Control', '2': 'Variation 1' }
      }
    };

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments.length).toBe(1);
    expect(experiments[0].campaignId).toBe('42');
    expect(experiments[0].variationId).toBe('2');
    expect(experiments[0].variationName).toBe('Variation 1');
  });

  it('reads multiple experiments', () => {
    window._vwo_exp = {
      '42': {
        combination_chosen: 2,
        comb_n: { '1': 'Control', '2': 'Variation 1' }
      },
      '99': {
        combination_chosen: 3,
        comb_n: { '1': 'Control', '3': 'Big CTA' }
      }
    };

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments.length).toBe(2);
  });

  it('skips experiments without combination_chosen', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'V1' } },
      '99': { comb_n: { '1': 'Control' } }
    };

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments.length).toBe(1);
    expect(experiments[0].campaignId).toBe('42');
  });

  it('returns empty variationName when comb_n is missing', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 2 }
    };

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments[0].variationName).toBe('');
  });

  it('returns empty variationName when variation not in comb_n', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 5, comb_n: { '1': 'Control', '2': 'V1' } }
    };

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments[0].variationName).toBe('');
  });
});

// =========================================================================
// 8. DATALAYER TRACKING
// =========================================================================
describe('DataLayer tracking', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
    createMockDataLayer();
    window.ppLib.vwo!.configure({ accountId: '123' });
  });

  it('pushes experiment_impression events to dataLayer on init', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'Variation 1' } }
    };

    window.ppLib.vwo!.init();

    // Execute the trackExperiments callback from _vis_opt_queue
    for (const fn of window._vis_opt_queue) {
      fn();
    }

    const impressions = window.dataLayer.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(1);
    expect(impressions[0].experiment_id).toBe('42');
    expect(impressions[0].variation_id).toBe('2');
    expect(impressions[0].variation_name).toBe('Variation 1');
  });

  it('pushes multiple experiment impressions', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'V1' } },
      '99': { combination_chosen: 1, comb_n: { '1': 'Control' } }
    };

    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    const impressions = window.dataLayer.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(2);
  });

  it('does not push to dataLayer when trackToDataLayer is false', () => {
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'V1' } }
    };

    window.ppLib.vwo!.configure({ trackToDataLayer: false });
    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    const impressions = window.dataLayer.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(0);
  });

  it('creates dataLayer array if it does not exist', () => {
    delete window.dataLayer;
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'V1' } }
    };

    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    expect(window.dataLayer).toBeDefined();
    expect(Array.isArray(window.dataLayer)).toBe(true);
  });

  it('does not push when no experiments are active', () => {
    window._vwo_exp = {};

    window.ppLib.vwo!.init();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    const impressions = (window.dataLayer || []).filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(0);
  });
});

// =========================================================================
// 9. getVariation()
// =========================================================================
describe('getVariation()', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('returns null when _vwo_exp is not set', () => {
    expect(window.ppLib.vwo!.getVariation('42')).toBeNull();
  });

  it('returns null when campaign does not exist', () => {
    window._vwo_exp = {};
    expect(window.ppLib.vwo!.getVariation('999')).toBeNull();
  });

  it('returns null when combination_chosen is not set', () => {
    window._vwo_exp = { '42': {} };
    expect(window.ppLib.vwo!.getVariation('42')).toBeNull();
  });

  it('returns variation ID as string', () => {
    window._vwo_exp = { '42': { combination_chosen: 2 } };
    expect(window.ppLib.vwo!.getVariation('42')).toBe('2');
  });

  it('returns "1" for control variation', () => {
    window._vwo_exp = { '42': { combination_chosen: 1 } };
    expect(window.ppLib.vwo!.getVariation('42')).toBe('1');
  });
});

// =========================================================================
// 10. forceVariation()
// =========================================================================
describe('forceVariation()', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('stores forced variation in sessionStorage', () => {
    window.ppLib.vwo!.forceVariation('42', '3');

    const stored = sessionStorage.getItem('pp_vwo_force');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['42']).toBe('3');
  });

  it('pushes _vis_opt_set_combination to queue', () => {
    window._vis_opt_set_combination = vi.fn();
    window.ppLib.vwo!.forceVariation('42', '3');

    expect(window._vis_opt_queue).toBeDefined();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(3, 42);
  });

  it('accumulates multiple forced variations in sessionStorage', () => {
    window.ppLib.vwo!.forceVariation('42', '2');
    window.ppLib.vwo!.forceVariation('99', '1');

    const stored = sessionStorage.getItem('pp_vwo_force');
    const parsed = JSON.parse(stored!);
    expect(parsed['42']).toBe('2');
    expect(parsed['99']).toBe('1');
  });

  it('overwrites existing forced variation for same campaign', () => {
    window.ppLib.vwo!.forceVariation('42', '2');
    window.ppLib.vwo!.forceVariation('42', '5');

    const stored = sessionStorage.getItem('pp_vwo_force');
    const parsed = JSON.parse(stored!);
    expect(parsed['42']).toBe('5');
  });

  it('logs info message', () => {
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.forceVariation('42', '3');

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Forced variation'));
  });
});

// =========================================================================
// 11. trackGoal()
// =========================================================================
describe('trackGoal()', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('pushes goal conversion to VWO queue', () => {
    window.ppLib.vwo!.trackGoal(200);

    expect(window.VWO).toBeDefined();
    expect(Array.isArray(window.VWO)).toBe(true);
    expect(window.VWO.length).toBe(1);
    expect(window.VWO[0]).toEqual(['track.goalConversion', 200]);
  });

  it('includes revenue when provided', () => {
    window.ppLib.vwo!.trackGoal(200, 49.99);

    expect(window.VWO[0]).toEqual(['track.goalConversion', 200, 49.99]);
  });

  it('omits revenue when not provided', () => {
    window.ppLib.vwo!.trackGoal(300);

    expect(window.VWO[0]).toEqual(['track.goalConversion', 300]);
    expect(window.VWO[0].length).toBe(2);
  });

  it('creates VWO array if it does not exist', () => {
    delete window.VWO;
    window.ppLib.vwo!.trackGoal(100);

    expect(window.VWO).toBeDefined();
    expect(window.VWO.length).toBe(1);
  });

  it('appends to existing VWO array', () => {
    window.VWO = [['existing']];
    window.ppLib.vwo!.trackGoal(100);

    expect(window.VWO.length).toBe(2);
    expect(window.VWO[1]).toEqual(['track.goalConversion', 100]);
  });

  it('tracks multiple goals', () => {
    window.ppLib.vwo!.trackGoal(100);
    window.ppLib.vwo!.trackGoal(200, 10);

    expect(window.VWO.length).toBe(2);
    expect(window.VWO[0]).toEqual(['track.goalConversion', 100]);
    expect(window.VWO[1]).toEqual(['track.goalConversion', 200, 10]);
  });

  it('logs info message without revenue', () => {
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.trackGoal(200);

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Goal tracked: 200'));
  });

  it('logs info message with revenue', () => {
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.trackGoal(200, 25.5);

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('revenue: 25.5'));
  });

  it('handles revenue of 0', () => {
    window.ppLib.vwo!.trackGoal(100, 0);

    expect(window.VWO[0]).toEqual(['track.goalConversion', 100, 0]);
  });

  it('handles errors gracefully', () => {
    Object.defineProperty(window, 'VWO', {
      get() { throw new Error('access denied'); },
      set() { throw new Error('access denied'); },
      configurable: true
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.trackGoal(100);

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('trackGoal error'), expect.any(Error));

    delete window.VWO;
  });
});

// =========================================================================
// 12. DOM AUTO-TRACKING — Click
// =========================================================================
describe('DOM auto-tracking — Click', () => {
  beforeEach(() => {
    // Clean VWO artifacts from document.head
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
  });

  it('tracks goal on click of element with data-vwo-goal', () => {
    document.body.innerHTML = '<button data-vwo-goal="200">Buy</button>';
    window.ppLib.vwo!.init();

    const btn = document.querySelector('button')!;
    btn.click();

    expect(window.VWO).toBeDefined();
    expect(window.VWO[0]).toEqual(['track.goalConversion', 200]);
  });

  it('tracks goal with revenue from data-vwo-revenue', () => {
    document.body.innerHTML = '<button data-vwo-goal="200" data-vwo-revenue="49.99">Buy</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO[0]).toEqual(['track.goalConversion', 200, 49.99]);
  });

  it('ignores click on element with data-vwo-trigger="submit"', () => {
    document.body.innerHTML = '<button data-vwo-goal="200" data-vwo-trigger="submit">Submit</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO).toBeUndefined();
  });

  it('ignores click on element with data-vwo-trigger="view"', () => {
    document.body.innerHTML = '<button data-vwo-goal="200" data-vwo-trigger="view">View</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO).toBeUndefined();
  });

  it('tracks click on child element (event delegation)', () => {
    document.body.innerHTML = '<div data-vwo-goal="300"><span id="child">Click me</span></div>';
    window.ppLib.vwo!.init();

    document.getElementById('child')!.click();

    expect(window.VWO[0]).toEqual(['track.goalConversion', 300]);
  });

  it('ignores click on element without data-vwo-goal', () => {
    document.body.innerHTML = '<button>No goal</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO).toBeUndefined();
  });

  it('debounces rapid clicks on the same element', () => {
    document.body.innerHTML = '<button data-vwo-goal="200">Buy</button>';
    window.ppLib.vwo!.init();

    const btn = document.querySelector('button')!;
    btn.click();
    btn.click();
    btn.click();

    expect(window.VWO.length).toBe(1);
  });

  it('tracks separate elements independently', () => {
    document.body.innerHTML = '<button id="a" data-vwo-goal="100">A</button><button id="b" data-vwo-goal="200">B</button>';
    window.ppLib.vwo!.init();

    document.getElementById('a')!.click();
    document.getElementById('b')!.click();

    expect(window.VWO.length).toBe(2);
    expect(window.VWO[0]).toEqual(['track.goalConversion', 100]);
    expect(window.VWO[1]).toEqual(['track.goalConversion', 200]);
  });

  it('ignores invalid revenue value', () => {
    document.body.innerHTML = '<button data-vwo-goal="200" data-vwo-revenue="abc">Buy</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO[0]).toEqual(['track.goalConversion', 200]);
  });

  it('defaults trigger to click when data-vwo-trigger is absent', () => {
    document.body.innerHTML = '<button data-vwo-goal="200">Buy</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO.length).toBe(1);
  });

  it('works with custom attribute names', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({
      accountId: '123',
      attributes: { goal: 'data-goal', revenue: 'data-rev', trigger: 'data-trig' }
    });
    document.body.innerHTML = '<button data-goal="500" data-rev="10">Buy</button>';
    window.ppLib.vwo!.init();

    document.querySelector('button')!.click();

    expect(window.VWO[0]).toEqual(['track.goalConversion', 500, 10]);
  });
});

// =========================================================================
// 13. DOM AUTO-TRACKING — Form submit
// =========================================================================
describe('DOM auto-tracking — Form submit', () => {
  beforeEach(() => {
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
  });

  it('tracks goal on form submit with data-vwo-trigger="submit"', () => {
    document.body.innerHTML = '<form data-vwo-goal="300" data-vwo-trigger="submit"><input type="text"></form>';
    window.ppLib.vwo!.init();

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(window.VWO).toBeDefined();
    expect(window.VWO[0]).toEqual(['track.goalConversion', 300]);
  });

  it('tracks goal with revenue on form submit', () => {
    document.body.innerHTML = '<form data-vwo-goal="300" data-vwo-trigger="submit" data-vwo-revenue="99.50"><input type="text"></form>';
    window.ppLib.vwo!.init();

    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(window.VWO[0]).toEqual(['track.goalConversion', 300, 99.5]);
  });

  it('ignores form submit without data-vwo-trigger="submit"', () => {
    document.body.innerHTML = '<form data-vwo-goal="300"><input type="text"></form>';
    window.ppLib.vwo!.init();

    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(window.VWO).toBeUndefined();
  });

  it('ignores form without data-vwo-goal', () => {
    document.body.innerHTML = '<form data-vwo-trigger="submit"><input type="text"></form>';
    window.ppLib.vwo!.init();

    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(window.VWO).toBeUndefined();
  });

  it('debounces rapid form submits', () => {
    document.body.innerHTML = '<form data-vwo-goal="300" data-vwo-trigger="submit"><input type="text"></form>';
    window.ppLib.vwo!.init();

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(window.VWO.length).toBe(1);
  });
});

// =========================================================================
// 14. DOM AUTO-TRACKING — View (IntersectionObserver)
// =========================================================================
describe('DOM auto-tracking — View', () => {
  let observedElements: Element[];
  let observerCallback: IntersectionObserverCallback;
  let mockObserver: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let ioConstructorArgs: { callback: any; options: any };

  beforeEach(() => {
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());

    observedElements = [];
    ioConstructorArgs = { callback: null, options: null };
    mockObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    };

    // Use a class mock so `new IntersectionObserver(cb, opts)` returns a proper instance
    (window as any).IntersectionObserver = class {
      observe = vi.fn((el: Element) => { observedElements.push(el); });
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        observerCallback = cb;
        ioConstructorArgs = { callback: cb, options: opts };
        mockObserver = this as any;
      }
    };

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
  });

  afterEach(() => {
    delete (window as any).IntersectionObserver;
  });

  it('observes elements with data-vwo-trigger="view"', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    expect(mockObserver.observe).toHaveBeenCalledTimes(1);
    expect(observedElements[0].getAttribute('data-vwo-goal')).toBe('400');
  });

  it('tracks goal when element becomes visible', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    const el = document.querySelector('[data-vwo-goal]')!;
    observerCallback([{ isIntersecting: true, target: el } as IntersectionObserverEntry], mockObserver as any);

    expect(window.VWO).toBeDefined();
    expect(window.VWO[0]).toEqual(['track.goalConversion', 400]);
  });

  it('unobserves element after tracking', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    const el = document.querySelector('[data-vwo-goal]')!;
    observerCallback([{ isIntersecting: true, target: el } as IntersectionObserverEntry], mockObserver as any);

    expect(mockObserver.unobserve).toHaveBeenCalledWith(el);
  });

  it('ignores non-intersecting entries', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    const el = document.querySelector('[data-vwo-goal]')!;
    observerCallback([{ isIntersecting: false, target: el } as IntersectionObserverEntry], mockObserver as any);

    expect(window.VWO).toBeUndefined();
    expect(mockObserver.unobserve).not.toHaveBeenCalled();
  });

  it('does not observe elements without view trigger', () => {
    document.body.innerHTML = '<div data-vwo-goal="400">No trigger</div>';
    window.ppLib.vwo!.init();

    expect(mockObserver.observe).not.toHaveBeenCalled();
  });

  it('observes multiple view-trigger elements', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">A</div><div data-vwo-goal="500" data-vwo-trigger="view">B</div>';
    window.ppLib.vwo!.init();

    expect(mockObserver.observe).toHaveBeenCalledTimes(2);
  });

  it('uses threshold 0.5', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    expect(ioConstructorArgs.options).toEqual({ threshold: 0.5 });
  });

  it('tracks view goal with revenue', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view" data-vwo-revenue="75">Visible</div>';
    window.ppLib.vwo!.init();

    const el = document.querySelector('[data-vwo-goal]')!;
    observerCallback([{ isIntersecting: true, target: el } as IntersectionObserverEntry], mockObserver as any);

    expect(window.VWO[0]).toEqual(['track.goalConversion', 400, 75]);
  });

  it('scanViewGoals() re-scans DOM for new elements', () => {
    window.ppLib.vwo!.init();
    expect(mockObserver.observe).not.toHaveBeenCalled();

    // Add element after init
    document.body.innerHTML = '<div data-vwo-goal="600" data-vwo-trigger="view">Late</div>';
    window.ppLib.vwo!.scanViewGoals();

    expect(mockObserver.observe).toHaveBeenCalledTimes(1);
  });

  it('disconnects previous observer on re-scan', () => {
    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">A</div>';
    window.ppLib.vwo!.init();

    const firstObserver = mockObserver;

    document.body.innerHTML = '<div data-vwo-goal="500" data-vwo-trigger="view">B</div>';
    window.ppLib.vwo!.scanViewGoals();

    expect(firstObserver.disconnect).toHaveBeenCalled();
  });

  it('handles missing IntersectionObserver gracefully', () => {
    delete (window as any).IntersectionObserver;
    const logSpy = vi.spyOn(window.ppLib, 'log');

    document.body.innerHTML = '<div data-vwo-goal="400" data-vwo-trigger="view">Visible</div>';
    window.ppLib.vwo!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('IntersectionObserver not available'));
  });
});

// =========================================================================
// 15. DEBOUNCE MAP PRUNING
// =========================================================================
describe('Debounce map pruning', () => {
  beforeEach(() => {
    const oldStyle = document.getElementById('_vis_opt_path_hides');
    if (oldStyle) oldStyle.remove();
    document.querySelectorAll('script[src*="visualwebsiteoptimizer.com"]').forEach(s => s.remove());

    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
  });

  it('prunes stale debounce entries after 100 writes', () => {
    vi.useFakeTimers();

    // Create 100 unique elements to trigger pruning
    let html = '';
    for (let i = 0; i < 101; i++) {
      html += '<button id="btn' + i + '" data-vwo-goal="' + (100 + i) + '">B' + i + '</button>';
    }
    document.body.innerHTML = html;
    window.ppLib.vwo!.init();

    // Click first element at t=0
    document.getElementById('btn0')!.click();
    expect(window.VWO.length).toBe(1);

    // Advance past debounce window
    vi.advanceTimersByTime(400);

    // Click 100 more unique elements to trigger pruning at count=100
    for (let i = 1; i <= 100; i++) {
      document.getElementById('btn' + i)!.click();
    }

    // The first element's debounce entry should be pruned; clicking it again should work
    document.getElementById('btn0')!.click();
    expect(window.VWO[window.VWO.length - 1]).toEqual(['track.goalConversion', 100]);

    vi.useRealTimers();
  });
});

// =========================================================================
// 16. isFeatureEnabled()
// =========================================================================
describe('isFeatureEnabled()', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('returns false when _vwo_exp is not set', () => {
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(false);
  });

  it('returns false when campaign does not exist', () => {
    window._vwo_exp = {};
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(false);
  });

  it('returns false when combination_chosen is not set', () => {
    window._vwo_exp = { '42': {} };
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(false);
  });

  it('returns false for control variation (1)', () => {
    window._vwo_exp = { '42': { combination_chosen: 1 } };
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(false);
  });

  it('returns false for control variation as string "1"', () => {
    window._vwo_exp = { '42': { combination_chosen: '1' } };
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(false);
  });

  it('returns true for non-control variation', () => {
    window._vwo_exp = { '42': { combination_chosen: 2 } };
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(true);
  });

  it('returns true for variation 3', () => {
    window._vwo_exp = { '42': { combination_chosen: 3 } };
    expect(window.ppLib.vwo!.isFeatureEnabled('42')).toBe(true);
  });
});

// =========================================================================
// 17. INIT ORCHESTRATION
// =========================================================================
describe('Init orchestration', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true
    });
  });

  function setLocation(url: string) {
    delete (window as any).location;
    window.location = { ...originalLocation, href: url } as Location;
  }

  it('full init sequence: forced variations → SmartCode → track queue', () => {
    setLocation('https://example.com?vwo=42:2');
    loadWithCommon('vwo');

    window._vis_opt_set_combination = vi.fn();
    createMockDataLayer();

    window.ppLib.vwo!.configure({ accountId: '123' });

    // Set up experiments for tracking
    window._vwo_exp = {
      '42': { combination_chosen: 2, comb_n: { '2': 'V1' } }
    };

    window.ppLib.vwo!.init();

    // 1. Forced variations should be stored
    const stored = sessionStorage.getItem('pp_vwo_force');
    expect(stored).not.toBeNull();

    // 2. SmartCode should be injected
    expect(window._vwo_code).toBeDefined();
    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript).toBeDefined();

    // 3. Execute queue: forced variation + tracking
    for (const fn of window._vis_opt_queue) {
      fn();
    }

    expect(window._vis_opt_set_combination).toHaveBeenCalledWith(2, 42);

    const impressions = window.dataLayer.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(1);
  });

  it('init without forced variations still injects SmartCode and tracks', () => {
    loadWithCommon('vwo');
    createMockDataLayer();

    window._vwo_exp = {
      '10': { combination_chosen: 1, comb_n: { '1': 'Control' } }
    };

    window.ppLib.vwo!.configure({ accountId: '555' });
    window.ppLib.vwo!.init();

    expect(window._vwo_code).toBeDefined();

    for (const fn of window._vis_opt_queue) {
      fn();
    }

    const impressions = window.dataLayer.filter((e: any) => e.event === 'experiment_impression');
    expect(impressions.length).toBe(1);
    expect(impressions[0].experiment_id).toBe('10');
  });

  it('script URL includes encoded document URL', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript!.src).toContain('u=');
  });

  it('script URL includes random cache buster', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: '123' });
    window.ppLib.vwo!.init();

    const scripts = document.querySelectorAll('script');
    const vwoScript = Array.from(scripts).find(s => s.src.includes('visualwebsiteoptimizer.com'));
    expect(vwoScript!.src).toContain('r=');
  });

  it('getConfig returns the live config object', () => {
    loadWithCommon('vwo');
    window.ppLib.vwo!.configure({ accountId: 'xyz' });
    const config = window.ppLib.vwo!.getConfig();
    expect(config.accountId).toBe('xyz');
  });

  it('auto-enables VWO platform in event-source when event-source is loaded', () => {
    loadWithCommon('event-source');
    loadModule('vwo');

    // Verify VWO platform starts disabled in event-source
    expect(window.ppLib.eventSource!.getConfig().platforms.vwo.enabled).toBe(false);

    window.ppLib.vwo!.configure({ accountId: '999' });
    window.ppLib.vwo!.init();

    // VWO init should have auto-enabled the VWO platform in event-source
    expect(window.ppLib.eventSource!.getConfig().platforms.vwo.enabled).toBe(true);
  });

  it('does not error when event-source is not loaded', () => {
    loadWithCommon('vwo');

    // Ensure event-source is not loaded
    delete window.ppLib.eventSource;

    window.ppLib.vwo!.configure({ accountId: '888' });

    expect(() => {
      window.ppLib.vwo!.init();
    }).not.toThrow();
  });
});

// =========================================================================
// 18. ERROR HANDLING
// =========================================================================
describe('Error handling', () => {
  beforeEach(() => {
    loadWithCommon('vwo');
  });

  it('getVariation handles errors gracefully', () => {
    // Set _vwo_exp to a value that will throw on property access
    Object.defineProperty(window, '_vwo_exp', {
      get() { throw new Error('access denied'); },
      configurable: true
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = window.ppLib.vwo!.getVariation('42');

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('getVariation error'), expect.any(Error));

    // Clean up
    delete window._vwo_exp;
  });

  it('isFeatureEnabled handles errors gracefully', () => {
    Object.defineProperty(window, '_vwo_exp', {
      get() { throw new Error('access denied'); },
      configurable: true
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = window.ppLib.vwo!.isFeatureEnabled('42');

    expect(result).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('isFeatureEnabled error'), expect.any(Error));

    delete window._vwo_exp;
  });

  it('forceVariation handles errors gracefully', () => {
    // Make sessionStorage.setItem throw
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.vwo!.forceVariation('42', '2');

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Failed to persist'));
  });

  it('readExperiments handles errors gracefully', () => {
    Object.defineProperty(window, '_vwo_exp', {
      get() { throw new Error('boom'); },
      configurable: true
    });

    const experiments = window.ppLib.vwo!.getActiveExperiments();
    expect(experiments).toEqual([]);

    delete window._vwo_exp;
  });
});
