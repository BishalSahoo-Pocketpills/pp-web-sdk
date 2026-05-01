/**
 * Mixpanel Native Coverage Test
 *
 * Imports the mixpanel source directly through Vitest's transform pipeline
 * instead of loading the pre-built IIFE via vm.runInThisContext(). This bypasses
 * the ast-v8-to-istanbul conversion bug that produces negative branch counts
 * when processing esbuild IIFE output with inline source maps.
 *
 * All other mixpanel test files use { coverable: false } so their IIFE
 * evaluations don't contribute to src/mixpanel/index.ts coverage. This file
 * is the sole source of mixpanel coverage data.
 *
 * Common is loaded via IIFE (not native import) to avoid corrupting common's
 * coverage data through merge of IIFE + native V8 evaluations.
 */
import { loadModule } from '../helpers/iife-loader.ts';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';
import { setCookie, clearAllCookies } from '../helpers/mock-cookies.ts';

// =========================================================================
// Helper: ensure a <script> tag exists so getElementsByTagName('script')[0]
// returns a valid node inside loadMixpanelSDK().
// Also mock insertBefore to prevent actual network requests.
// =========================================================================
let insertBeforeSpy: ReturnType<typeof vi.spyOn> | null = null;

function setupScriptEnv() {
  if (!document.getElementsByTagName('script').length) {
    const s = document.createElement('script');
    s.src = 'dummy.js';
    document.head.appendChild(s);
  }
  insertBeforeSpy = vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function () {
    return arguments[0];
  });
}

function teardownScriptEnv() {
  if (insertBeforeSpy) {
    insertBeforeSpy.mockRestore();
    insertBeforeSpy = null;
  }
}

// =========================================================================
// freshLoad: reset modules, load common via IIFE, then native-import mixpanel
// =========================================================================
async function freshLoad(configOverrides?: Record<string, any>) {
  vi.resetModules();
  delete window.ppLib;
  delete window.ppLibReady;
  delete (window as any).mixpanel;

  // Load common via IIFE (provides ppLib)
  loadModule('common');
  window.ppLib.config.debug = true;

  // Native import of mixpanel for V8 coverage attribution
  await import('../../src/mixpanel/index.ts');

  // Configure if overrides provided
  if (configOverrides) {
    window.ppLib.mixpanel.configure(configOverrides);
  }
}

// =========================================================================
// Helper: fresh load, configure, call init, extract loaded callback.
// =========================================================================
async function initAndGetLoadedCallback(configOverrides?: Record<string, any>) {
  await freshLoad({
    token: 'test-token-abc',
    projectName: 'TestProject',
    ...configOverrides,
  });

  setupScriptEnv();
  window.ppLib.mixpanel.init();

  const initArgs = (window as any).mixpanel._i[0];
  const loadedCallback = initArgs[1].loaded;
  return loadedCallback;
}

/**
 * Convenience: call the loaded callback with a mock mixpanel,
 * after replacing the global so SessionManager can use it.
 */
function invokeLoadedCallback(loadedCallback: (mp: any) => void, mp: any) {
  (window as any).mixpanel = mp;
  loadedCallback(mp);
}

describe('Mixpanel native coverage', () => {

  afterEach(() => {
    teardownScriptEnv();
    delete (window as any).mixpanel;
    vi.restoreAllMocks();
    clearAllCookies();
  });

  // ==========================================================================
  // 1. IIFE BOOTSTRAP
  // ==========================================================================
  describe('IIFE bootstrap', () => {
    it('attaches ppLib.mixpanel when ppLib._isReady is true', async () => {
      await freshLoad();

      expect(window.ppLib).toBeDefined();
      expect(window.ppLib._isReady).toBe(true);
      expect(window.ppLib.mixpanel).toBeDefined();
    });

    it('exposes all expected public API methods', async () => {
      await freshLoad();
      const api = window.ppLib.mixpanel;

      expect(typeof api.configure).toBe('function');
      expect(typeof api.init).toBe('function');
      expect(typeof api.getMixpanelCookieData).toBe('function');
      expect(typeof api.getConfig).toBe('function');
    });

    it('pushes initModule to ppLibReady when ppLib is not available', async () => {
      vi.resetModules();
      delete window.ppLib;
      delete window.ppLibReady;
      delete (window as any).mixpanel;

      // Import mixpanel without loading common first
      await import('../../src/mixpanel/index.ts');

      expect(window.ppLib).toBeUndefined();
      expect(window.ppLibReady).toBeDefined();
      expect(Array.isArray(window.ppLibReady)).toBe(true);
      expect(window.ppLibReady.length).toBe(1);
      expect(typeof window.ppLibReady[0]).toBe('function');
    });

    it('ppLibReady callback is consumed when common loads afterwards', async () => {
      vi.resetModules();
      delete window.ppLib;
      delete window.ppLibReady;
      delete (window as any).mixpanel;

      await import('../../src/mixpanel/index.ts');
      expect(window.ppLibReady.length).toBe(1);

      // Load common — it processes the ppLibReady queue
      loadModule('common');
      expect(window.ppLib.mixpanel).toBeDefined();
    });

    it('logs module loaded message', async () => {
      await freshLoad();
      const logSpy = vi.spyOn(window.ppLib, 'log');

      // Re-import to observe the log call
      vi.resetModules();
      delete (window as any).mixpanel;
      await import('../../src/mixpanel/index.ts');

      expect(logSpy).toHaveBeenCalledWith('info', '[ppMixpanel] Module loaded');
    });
  });

  // ==========================================================================
  // 2. CONFIG DEFAULTS
  // ==========================================================================
  describe('CONFIG defaults', () => {
    it('has correct default values', async () => {
      await freshLoad();
      const config = window.ppLib.mixpanel.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.token).toBe('');
      expect(config.projectName).toBe('');
      expect(config.crossSubdomainCookie).toBe(true);
      expect(config.optOutByDefault).toBe(false);
      expect(config.sessionTimeout).toBe(1800000);
      expect(config.cookieNames).toEqual({
        userId: 'userId',
        ipAddress: 'ipAddress',
        experiments: 'exp',
      });
    });
  });

  // ==========================================================================
  // 3. configure()
  // ==========================================================================
  describe('configure()', () => {
    it('merges options into CONFIG and returns it', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure({
        token: 'abc123',
        projectName: 'Test',
      });

      expect(result.token).toBe('abc123');
      expect(result.projectName).toBe('Test');
    });

    it('deep merges nested objects like cookieNames', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure({
        cookieNames: { userId: 'uid' },
      });

      expect(result.cookieNames.userId).toBe('uid');
      expect(result.cookieNames.ipAddress).toBe('ipAddress');
      expect(result.cookieNames.experiments).toBe('exp');
    });

    it('returns CONFIG when called with no arguments', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure();

      expect(result).toBeDefined();
      expect(result.cookieNames).toBeDefined();
    });

    it('returns CONFIG when called with null (falsy options)', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure(null as any);

      expect(result).toBeDefined();
      expect(result.token).toBe('');
    });

    it('overrides sessionTimeout', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure({ sessionTimeout: 600000 });
      expect(result.sessionTimeout).toBe(600000);
    });

    it('overrides optOutByDefault', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure({ optOutByDefault: true });
      expect(result.optOutByDefault).toBe(true);
    });

    it('overrides crossSubdomainCookie', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.configure({ crossSubdomainCookie: true });
      expect(result.crossSubdomainCookie).toBe(true);
    });
  });

  // ==========================================================================
  // 4. getConfig() — returns deep copy
  // ==========================================================================
  describe('getConfig()', () => {
    it('returns a deep copy (mutations do not affect internal CONFIG)', async () => {
      await freshLoad();
      const config1 = window.ppLib.mixpanel.getConfig();
      config1.token = 'mutated';
      config1.cookieNames.userId = 'mutated';

      const config2 = window.ppLib.mixpanel.getConfig();
      expect(config2.token).toBe('');
      expect(config2.cookieNames.userId).toBe('userId');
    });

    it('reflects changes made by configure()', async () => {
      await freshLoad();
      window.ppLib.mixpanel.configure({ token: 'changed' });
      const config = window.ppLib.mixpanel.getConfig();
      expect(config.token).toBe('changed');
    });
  });

  // ==========================================================================
  // 5. Init guards — enabled and token
  // ==========================================================================
  describe('init guards', () => {
    it('skips initialization when enabled is false', async () => {
      await freshLoad({ enabled: false, token: 'test-token' });
      const logSpy = vi.spyOn(window.ppLib, 'log');

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(logSpy).toHaveBeenCalledWith('info', '[ppMixpanel] Module disabled via config');
      expect((window as any).mixpanel).toBeUndefined();
    });

    it('proceeds after re-enabling', async () => {
      await freshLoad({ enabled: false, token: 'test-token' });
      window.ppLib.mixpanel.init();

      window.ppLib.mixpanel.configure({ enabled: true });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel._i).toBeDefined();
      expect((window as any).mixpanel._i.length).toBe(1);
    });

    it('warns and returns early when no token configured', async () => {
      await freshLoad();
      const logSpy = vi.spyOn(window.ppLib, 'log');

      window.ppLib.mixpanel.init();

      expect(logSpy).toHaveBeenCalledWith(
        'warn',
        '[ppMixpanel] No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.'
      );
      expect((window as any).mixpanel).toBeUndefined();
    });
  });

  // ==========================================================================
  // 6. loadMixpanelSDK()
  // ==========================================================================
  describe('loadMixpanelSDK()', () => {
    it('creates a stub on window.mixpanel with __SV = 1.2', async () => {
      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel).toBeDefined();
      expect((window as any).mixpanel.__SV).toBe(1.2);
    });

    it('creates _i array and pushes init call', async () => {
      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(Array.isArray((window as any).mixpanel._i)).toBe(true);
      expect((window as any).mixpanel._i.length).toBe(1);
    });

    it('inserts a script tag via insertBefore', async () => {
      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(insertBeforeSpy).toHaveBeenCalled();
      const scriptArg = insertBeforeSpy!.mock.calls[0][0];
      expect(scriptArg.tagName).toBe('SCRIPT');
      expect(scriptArg.src).toContain('cdn.mxpnl.com/libs/mixpanel-2-latest.min.js');
      expect(scriptArg.async).toBe(true);
    });

    it('does nothing if __SV already exists on window.mixpanel', async () => {
      await freshLoad({ token: 'tok123' });

      (window as any).mixpanel = { __SV: 1.2, init: vi.fn() };

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel.init).toHaveBeenCalled();
    });

    it('stub init pushes to _i with correct args', async () => {
      await freshLoad({ token: 'my-token' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const entry = (window as any).mixpanel._i[0];
      expect(entry[0]).toBe('my-token');
      expect(entry[1]).toBeDefined();
      expect(typeof entry[1].loaded).toBe('function');
      expect(entry[2]).toBe('mixpanel');
    });

    it('stub toString returns "mixpanel (stub)" for default', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel.toString()).toBe('mixpanel (stub)');
      expect((window as any).mixpanel.toString(true)).toBe('mixpanel');
    });

    it('stub people.toString returns correct string', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel.people.toString()).toBe('mixpanel.people (stub)');
    });

    it('stub methods push calls to the array', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      (window as any).mixpanel.track('testEvent', { key: 'value' });
      const found = (window as any).mixpanel.some(
        (item: any) => Array.isArray(item) && item[0] === 'track'
      );
      expect(found).toBe(true);
    });

    it('stub get_group returns an object with group methods', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const group = (window as any).mixpanel.get_group('company', 'acme');
      expect(group).toBeDefined();
      expect(typeof group.set).toBe('function');
      expect(typeof group.set_once).toBe('function');
      expect(typeof group.union).toBe('function');
      expect(typeof group.unset).toBe('function');
      expect(typeof group.remove).toBe('function');
      expect(typeof group.delete).toBe('function');
    });

    it('get_group methods are callable and execute inner function body', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const group = (window as any).mixpanel.get_group('company', 'acme');
      expect(typeof group.set).toBe('function');

      // Call group methods — in strict mode, undeclared variables may throw
      try {
        group.set('key', 'value');
      } catch (e) {
        expect(e).toBeInstanceOf(ReferenceError);
      }

      try {
        group.union('key', ['value']);
      } catch (e) {
        // Expected
      }

      try {
        group.remove('key');
      } catch (e) {
        // Expected
      }
    });

    it('stub init with named instance uses a different sub-array', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      (window as any).mixpanel.init('another-token', {}, 'secondary');
      expect((window as any).mixpanel._i.length).toBe(2);
      expect((window as any).mixpanel.secondary).toBeDefined();
      expect((window as any).mixpanel.secondary.people).toBeDefined();
      expect((window as any).mixpanel.secondary.toString()).toBe('mixpanel.secondary (stub)');
      expect((window as any).mixpanel.secondary.toString(true)).toBe('mixpanel.secondary');
      expect((window as any).mixpanel.secondary.people.toString()).toBe(
        'mixpanel.secondary.people (stub)'
      );
    });

    it('people stub methods push to the people array', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      (window as any).mixpanel.people.set({ name: 'Test' });
      const found = (window as any).mixpanel.people.some(
        (item: any) => Array.isArray(item) && item[0] === 'set'
      );
      expect(found).toBe(true);
    });

    it('creates people sub-object on stub', async () => {
      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect((window as any).mixpanel.people).toBeDefined();
    });
  });

  // ==========================================================================
  // 7. Mixpanel SDK loader — mpeditor hash state
  // ==========================================================================
  describe('mpeditor hash state', () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('handles mpeditor hash state with empty desiredHash', async () => {
      const state = JSON.stringify({ action: 'mpeditor', desiredHash: '' });
      const encodedState = encodeURIComponent(state);

      delete (window as any).location;
      (window as any).location = {
        ...originalLocation,
        hash: '#state=' + encodedState,
        pathname: '/test',
        search: '',
        href: 'http://localhost/test#state=' + encodedState,
      };

      const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(sessionStorage.getItem('_mpcehash')).toBe('#state=' + encodedState);
      expect(replaceStateSpy).toHaveBeenCalledWith('', '', '/test');

      replaceStateSpy.mockRestore();
      sessionStorage.clear();
    });

    it('handles mpeditor hash state with desiredHash', async () => {
      const state = JSON.stringify({ action: 'mpeditor', desiredHash: '#myHash' });
      const encodedState = encodeURIComponent(state);

      delete (window as any).location;
      (window as any).location = {
        ...originalLocation,
        hash: '#state=' + encodedState,
        pathname: '/test',
        search: '?q=1',
        href: 'http://localhost/test?q=1#state=' + encodedState,
      };

      const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(replaceStateSpy).toHaveBeenCalledWith('#myHash', '', '/test?q=1');

      replaceStateSpy.mockRestore();
      sessionStorage.clear();
    });

    it('does not throw when hash state JSON parse fails', async () => {
      delete (window as any).location;
      (window as any).location = {
        ...originalLocation,
        hash: '#state=not-valid-json',
        pathname: '/test',
        search: '',
        href: 'http://localhost/test#state=not-valid-json',
      };

      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      expect(() => window.ppLib.mixpanel.init()).not.toThrow();
    });

    it('does not process hash when action is not mpeditor', async () => {
      const state = JSON.stringify({ action: 'other' });
      const encodedState = encodeURIComponent(state);

      delete (window as any).location;
      (window as any).location = {
        ...originalLocation,
        hash: '#state=' + encodedState,
        pathname: '/test',
        search: '',
        href: 'http://localhost/test#state=' + encodedState,
      };

      const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(replaceStateSpy).not.toHaveBeenCalled();

      replaceStateSpy.mockRestore();
    });

    it('does not process hash when no state param in hash', async () => {
      delete (window as any).location;
      (window as any).location = {
        ...originalLocation,
        hash: '#foo=bar',
        pathname: '/test',
        search: '',
        href: 'http://localhost/test#foo=bar',
      };

      const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      expect(replaceStateSpy).not.toHaveBeenCalled();

      replaceStateSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 8. mixpanel.init() call with correct config
  // ==========================================================================
  describe('mixpanel.init() call', () => {
    it('passes correct config to mixpanel.init', async () => {
      await freshLoad({
        token: 'my-token',
        crossSubdomainCookie: true,
        optOutByDefault: true,
      });

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      expect(initArgs[0]).toBe('my-token');
      expect(initArgs[1].cross_subdomain_cookie).toBe(true);
      expect(initArgs[1].opt_out_tracking_by_default).toBe(true);
      expect(initArgs[1].api_transport).toBe('sendBeacon');
      expect(typeof initArgs[1].loaded).toBe('function');
    });
  });

  // ==========================================================================
  // 8b. Cross-subdomain migration
  // ==========================================================================
  describe('cross-subdomain migration', () => {
    afterEach(() => {
      sessionStorage.removeItem('pp_mp_migrated');
    });

    it('re-identifies identified user when distinct_id changes after init', async () => {
      // Set Mixpanel cookie with a known distinct_id
      setCookie('mp_test-token-abc_mixpanel', JSON.stringify({ distinct_id: 'user-123' }));

      const loadedCallback = await initAndGetLoadedCallback({
        crossSubdomainCookie: true,
      });
      const mp = createMockMixpanel();
      // Simulate distinct_id changing (subdomain → parent migration)
      mp.get_distinct_id = vi.fn(() => 'new-distinct-id-456');
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.identify).toHaveBeenCalledWith('user-123');
    });

    it('logs anonymous migration when distinct_id starts with $device:', async () => {
      setCookie('mp_test-token-abc_mixpanel', JSON.stringify({ distinct_id: '$device:anon-abc' }));

      const loadedCallback = await initAndGetLoadedCallback({
        crossSubdomainCookie: true,
      });
      const mp = createMockMixpanel();
      mp.get_distinct_id = vi.fn(() => 'new-anon-id');
      const logSpy = vi.spyOn(window.ppLib, 'log');
      invokeLoadedCallback(loadedCallback, mp);

      // Should NOT call identify for anonymous users
      expect(mp.identify).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Anonymous subdomain user migrated'));
    });

    it('does nothing when distinct_id is unchanged after init', async () => {
      setCookie('mp_test-token-abc_mixpanel', JSON.stringify({ distinct_id: 'same-id' }));

      const loadedCallback = await initAndGetLoadedCallback({
        crossSubdomainCookie: true,
      });
      const mp = createMockMixpanel();
      mp.get_distinct_id = vi.fn(() => 'same-id');
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.identify).not.toHaveBeenCalled();
    });

    it('skips migration when already migrated (sessionStorage flag)', async () => {
      sessionStorage.setItem('pp_mp_migrated', '1');
      setCookie('mp_test-token-abc_mixpanel', JSON.stringify({ distinct_id: 'user-x' }));

      const loadedCallback = await initAndGetLoadedCallback({
        crossSubdomainCookie: true,
      });
      const mp = createMockMixpanel();
      mp.get_distinct_id = vi.fn(() => 'different-id');
      invokeLoadedCallback(loadedCallback, mp);

      // Should not identify since migration was already done
      expect(mp.identify).not.toHaveBeenCalled();
    });

    it('handles cookie read error gracefully', async () => {
      await freshLoad({ token: 'test-token-abc', crossSubdomainCookie: true });
      const originalGetCookie = window.ppLib.getCookie;
      // Make getCookie throw — triggers pre-init catch (line 307-309)
      window.ppLib.getCookie = () => { throw new Error('cookie error'); };
      const logSpy = vi.spyOn(window.ppLib, 'log');

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      // Restore getCookie before loaded callback fires (it also uses getCookie)
      window.ppLib.getCookie = originalGetCookie;

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(logSpy).toHaveBeenCalledWith('warn', '[ppMixpanel] Pre-init cookie read error', expect.any(Error));
    });
  });

  // ==========================================================================
  // 9. Loaded callback — opt_in_tracking gate (CRITICAL)
  // ==========================================================================
  describe('loaded callback — opt_in_tracking gate', () => {
    it('calls opt_in_tracking when optOutByDefault is false (default)', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ optOutByDefault: false });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.opt_in_tracking).toHaveBeenCalled();
    });

    it('does NOT call opt_in_tracking when optOutByDefault is true', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ optOutByDefault: true });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.opt_in_tracking).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 10. Loaded callback — SessionManager
  // ==========================================================================
  describe('loaded callback — SessionManager', () => {
    it('updates SessionManager timeout from config', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 5000 });
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now(), 'session ID': 'existing' });
      invokeLoadedCallback(loadedCallback, mp);

      // Session within timeout, so existing session should be kept
      expect(mp.get_property('session ID')).toBe('existing');
    });

    it('creates new session when no last event time (check condition 1)', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // No last event time => new session is generated
      expect(mp.get_property('session ID')).toBeDefined();
      expect(mp.get_property('session ID')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('creates new session when no session ID exists (check condition 2)', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      // Set last event time but no session ID
      mp.register({ 'last event time': Date.now() });
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.get_property('session ID')).toBeDefined();
    });

    it('resets session on timeout (check condition 3)', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 1000 });
      const mp = createMockMixpanel();

      const oldTime = Date.now() - 5000;
      mp.register({ 'last event time': oldTime, 'session ID': 'old-session-id' });

      invokeLoadedCallback(loadedCallback, mp);

      const newSessionId = mp.get_property('session ID');
      expect(newSessionId).toBeDefined();
      expect(newSessionId).not.toBe('old-session-id');
    });

    it('does not reset session when within timeout', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 1800000 });
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now() - 1000, 'session ID': 'keep-me' });
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.get_property('session ID')).toBe('keep-me');
    });

    it('generateId produces unique values', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const id1 = mp.get_property('session ID');

      // Reset session state to trigger new ID generation
      mp._properties['session ID'] = undefined;
      mp._properties['last event time'] = undefined;
      mp.track('test');

      const id2 = mp.get_property('session ID');
      expect(id1).not.toBe(id2);
    });
  });

  // ==========================================================================
  // 11. Loaded callback — resetCampaign
  // ==========================================================================
  describe('loaded callback — resetCampaign', () => {
    it('sets all UTM params to $direct on session timeout', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 1 });
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now() - 100, 'session ID': 'old' });
      invokeLoadedCallback(loadedCallback, mp);

      const keywords = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      keywords.forEach((kw) => {
        expect(mp.people.set).toHaveBeenCalledWith(
          expect.objectContaining({ [kw + ' [last touch]']: '$direct' })
        );
      });
    });
  });

  // ==========================================================================
  // 12. Loaded callback — monkey-patch track()
  // ==========================================================================
  describe('loaded callback — monkey-patch track()', () => {
    it('replaces mp.track with a wrapper function', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      const originalTrack = mp.track;

      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.track).not.toBe(originalTrack);
      expect(typeof mp.track).toBe('function');
    });

    it('stores _ppOriginal reference', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      const originalTrack = mp.track;

      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.track._ppOriginal).toBe(originalTrack);
    });

    it('sets ppLib._mpTrackPatched to true', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(window.ppLib._mpTrackPatched).toBe(true);
    });

    it('calls SessionManager.check() and registers last event time on each track call', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const sessionIdBefore = mp.get_property('session ID');
      const timeBefore = Date.now();
      mp.track('Test Event', { key: 'val' });
      const timeAfter = Date.now();

      // Session stays the same (within timeout)
      expect(mp.get_property('session ID')).toBe(sessionIdBefore);

      // Last event time was updated
      const lastEventTime = mp.get_property('last event time');
      expect(lastEventTime).toBeGreaterThanOrEqual(timeBefore);
      expect(lastEventTime).toBeLessThanOrEqual(timeAfter);
    });

    it('calls original track function with all arguments passed through', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      const originalTrack = mp.track;

      invokeLoadedCallback(loadedCallback, mp);

      const callback = vi.fn();
      mp.track('MyEvent', { prop: 'val' }, callback);

      expect(originalTrack).toHaveBeenCalledWith('MyEvent', { prop: 'val' }, callback);
    });

    it('second loaded callback uses stored original — no wrapper nesting', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      const realOriginal = mp.track;

      // First invocation
      invokeLoadedCallback(loadedCallback, mp);
      expect(mp.track._ppOriginal).toBe(realOriginal);

      // Second invocation — re-wraps but uses stored _ppOriginal (no nesting)
      invokeLoadedCallback(loadedCallback, mp);
      expect(mp.track._ppOriginal).toBe(realOriginal);

      // Calling track() should invoke the original exactly once (not nested)
      mp.track('test_event');
      expect(realOriginal).toHaveBeenCalledTimes(1);
    });

    it('re-init with pre-patched track still uses stored original', async () => {
      await freshLoad({ token: 'test-token-abc', projectName: 'TestProject' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      const realOriginal = mp.track;

      // Simulate already-patched state with stored original
      mp.track._ppOriginal = realOriginal;

      invokeLoadedCallback(loadedCallback, mp);
      expect(mp.track._ppOriginal).toBe(realOriginal);
    });

    it('resets session and calls resetCampaign when track triggers timeout', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 1 });
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now(), 'session ID': 'initial-session' });
      invokeLoadedCallback(loadedCallback, mp);

      const sessionAfterInit = mp.get_property('session ID');

      // Simulate time passing
      mp._properties['last event time'] = Date.now() - 100;

      mp.track('Late Event');

      const sessionAfterTrack = mp.get_property('session ID');
      expect(sessionAfterTrack).not.toBe('initial-session');
    });
  });

  // ==========================================================================
  // 13. Loaded callback — base properties registration
  // ==========================================================================
  describe('loaded callback — base properties', () => {
    it('registers last event time and user agent', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({
          'last event time': expect.any(Number),
          pp_user_agent: window.navigator.userAgent,
        })
      );
    });

    it('registers project name when projectName is configured', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ projectName: 'MyProject' });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'MyProject' })
      );
    });

    it('does not register project name when projectName is empty', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ projectName: '' });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c: any) => c[0]);
      const hasProject = registerCalls.some((props: any) => props && 'project' in props);
      expect(hasProject).toBe(false);
    });
  });

  // ==========================================================================
  // 14. Loaded callback — cookie-based identity
  // ==========================================================================
  describe('loaded callback — cookie-based identity', () => {
    it('registers pp_user_id from userId cookie', async () => {
      setCookie('userId', 'user-42');

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ pp_user_id: 'user-42' })
      );
    });

    it('does not register pp_user_id when userId cookie is absent', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c: any) => c[0]);
      const hasUserId = registerCalls.some((props: any) => props && 'pp_user_id' in props);
      expect(hasUserId).toBe(false);
    });

    it('registers pp_user_ip from ipAddress cookie', async () => {
      setCookie('ipAddress', '192.168.1.1');

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ pp_user_ip: '192.168.1.1' })
      );
    });

    it('does not register pp_user_ip when ipAddress cookie is absent', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c: any) => c[0]);
      const hasIp = registerCalls.some((props: any) => props && 'pp_user_ip' in props);
      expect(hasIp).toBe(false);
    });
  });

  // ==========================================================================
  // 15. Loaded callback — experiment cookie
  // ==========================================================================
  describe('loaded callback — experiment cookie', () => {
    it('parses valid JSON experiment cookie and registers data', async () => {
      const expData = { experiment_a: 'variant_1', experiment_b: 'control' };
      setCookie('exp', JSON.stringify(expData));

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.people.set_once).toHaveBeenCalledWith(
        expect.objectContaining({
          experiment_a: 'variant_1',
          experiment_b: 'control',
        })
      );
      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({
          experiment_a: 'variant_1',
          experiment_b: 'control',
        })
      );
    });

    it('handles invalid JSON in experiment cookie gracefully', async () => {
      setCookie('exp', 'not-valid-json');

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // Security.json.parse returns null for invalid JSON — no experiment data set
      const setOnceCalls = mp.people.set_once.mock.calls.map((c: any) => c[0]);
      const hasExp = setOnceCalls.some(
        (props: any) => props && ('experiment_a' in props || 'experiment_b' in props)
      );
      expect(hasExp).toBe(false);
    });

    it('does nothing when experiment cookie is absent', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const setOnceCalls = mp.people.set_once.mock.calls.map((c: any) => c[0]);
      const hasExp = setOnceCalls.some(
        (props: any) => props && ('experiment_a' in props || 'experiment_b' in props)
      );
      expect(hasExp).toBe(false);
    });

    it('handles experiment cookie where json.parse returns non-object (string)', async () => {
      // Security.json.parse of a plain quoted string returns a string, not object
      setCookie('exp', '"just-a-string"');

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // typeof string !== 'object', so experiment registration is skipped
      const setOnceCalls = mp.people.set_once.mock.calls.map((c: any) => c[0]);
      const hasExp = setOnceCalls.some(
        (props: any) => props && typeof props === 'object' && 'experiment_a' in props
      );
      expect(hasExp).toBe(false);
    });
  });

  // ==========================================================================
  // 15b. Loaded callback — VWO experiment props initial registration error
  // ==========================================================================
  describe('loaded callback — VWO props initial registration error', () => {
    it('handles error in VWO props registration gracefully', async () => {
      await freshLoad({ token: 'test-token-abc' });

      // Set valid VWO props so readVWOProps() returns them
      (window.ppLib as any)._vwoExperimentProps = { vwo_experiments: '42:V1' };

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      // Make mp.register throw only when called with VWO props
      const originalRegister = mp.register;
      mp.register = vi.fn((props: any) => {
        if (props && props.vwo_experiments) {
          throw new Error('register failed');
        }
        return originalRegister(props);
      });
      const logSpy = vi.spyOn(window.ppLib, 'log');
      invokeLoadedCallback(loadedCallback, mp);

      expect(logSpy).toHaveBeenCalledWith('warn', '[ppMixpanel] Failed to register VWO experiment properties', expect.any(Error));

      delete (window.ppLib as any)._vwoExperimentProps;
    });

    it('ignores invalid JSON in sessionStorage via safe parse', async () => {
      await freshLoad({ token: 'test-token-abc' });

      // Invalid JSON — ppLib.Security.json.parse returns null, no throw
      sessionStorage.setItem('pp_vwo_exp_props', '{invalid json');

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // Should not have registered any VWO props
      const vwoCalls = mp.register.mock.calls.filter(
        (c: any) => c[0] && c[0].vwo_experiments
      );
      expect(vwoCalls.length).toBe(0);

      sessionStorage.removeItem('pp_vwo_exp_props');
    });
  });

  // ==========================================================================
  // 16. Loaded callback — campaignParams (UTM, gclid, fbclid)
  // ==========================================================================
  describe('loaded callback — campaignParams', () => {
    let originalURL: string;

    beforeEach(() => {
      originalURL = document.URL;
    });

    afterEach(() => {
      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('registers last touch and first touch UTM params when present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=shoes',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({
          'utm_source [last touch]': 'google',
          'utm_medium [last touch]': 'cpc',
          'utm_campaign [last touch]': 'spring',
          'utm_content [last touch]': 'ad1',
          'utm_term [last touch]': 'shoes',
        })
      );

      expect(mp.register_once).toHaveBeenCalledWith(
        expect.objectContaining({
          'utm_source [first touch]': 'google',
          'utm_medium [first touch]': 'cpc',
        })
      );

      expect(mp.people.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'utm_source [last touch]': 'google' })
      );

      expect(mp.people.set_once).toHaveBeenCalledWith(
        expect.objectContaining({ 'utm_source [first touch]': 'google' })
      );
    });

    it('sets empty string for missing UTM params when some are present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({
          'utm_source [last touch]': 'google',
          'utm_medium [last touch]': '',
          'utm_campaign [last touch]': '',
          'utm_content [last touch]': '',
          'utm_term [last touch]': '',
        })
      );
    });

    it('does not register UTM keys when no UTM params present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?foo=bar',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c: any) => c[0]);
      const hasUtm = registerCalls.some(
        (props: any) => props && props['utm_source [last touch]'] !== undefined
      );
      expect(hasUtm).toBe(false);
    });

    it('registers gclid when present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?gclid=abc123',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ gclid: 'abc123' })
      );
    });

    it('registers fbclid when present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?fbclid=fb456',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ fbclid: 'fb456' })
      );
    });

    it('registers both gclid and fbclid when both present', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?gclid=g1&fbclid=f2',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ gclid: 'g1', fbclid: 'f2' })
      );
    });

    it('does not register gclid/fbclid when absent', async () => {
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c: any) => c[0]);
      const hasGclid = registerCalls.some((props: any) => props && 'gclid' in props);
      const hasFbclid = registerCalls.some((props: any) => props && 'fbclid' in props);
      expect(hasGclid).toBe(false);
      expect(hasFbclid).toBe(false);
    });
  });

  // ==========================================================================
  // 17. getMixpanelCookieData()
  // ==========================================================================
  describe('getMixpanelCookieData()', () => {
    it('parses a valid mp_ cookie and returns the data', async () => {
      await freshLoad();
      const data = { distinct_id: '123', $initial_referrer: '$direct' };
      setCookie('mp_abc123_mixpanel', JSON.stringify(data));

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual(data);
    });

    it('returns empty object when no mp_ cookie exists', async () => {
      await freshLoad();
      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({});
    });

    it('returns empty object for invalid JSON in cookie', async () => {
      await freshLoad();
      setCookie('mp_abc123_mixpanel', '{not-valid-json}');

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({});
    });

    it('handles URL-encoded cookie values', async () => {
      await freshLoad();
      const data = { distinct_id: '456', name: 'test user' };
      const encoded = encodeURIComponent(JSON.stringify(data));
      document.cookie = `mp_def456_mixpanel=${encoded}`;

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual(data);
    });

    it('handles cookie with alphanumeric token part', async () => {
      await freshLoad();
      const data = { distinct_id: '789' };
      setCookie('mp_AbC123xYz_mixpanel', JSON.stringify(data));

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual(data);
    });

    it('ignores non-mixpanel cookies', async () => {
      await freshLoad();
      setCookie('other_cookie', 'value');
      setCookie('mp_abc123_mixpanel', JSON.stringify({ id: 1 }));
      setCookie('another', 'data');

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({ id: 1 });
    });

    it('returns last matching cookie when multiple mp_ cookies exist', async () => {
      await freshLoad();
      setCookie('mp_first_mixpanel', JSON.stringify({ id: 1 }));
      setCookie('mp_second_mixpanel', JSON.stringify({ id: 2 }));

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({ id: 2 });
    });

    it('logs error and returns empty object on exception', async () => {
      await freshLoad();
      window.ppLib.config.debug = true;
      const logSpy = vi.spyOn(window.ppLib, 'log');

      const originalCookieDescriptor =
        Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(document, 'cookie');

      Object.defineProperty(document, 'cookie', {
        get() {
          throw new Error('cookie access denied');
        },
        configurable: true,
      });

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({});
      expect(logSpy).toHaveBeenCalledWith(
        'error',
        'getMixpanelCookieData error',
        expect.any(Error)
      );

      if (originalCookieDescriptor) {
        Object.defineProperty(document, 'cookie', originalCookieDescriptor);
      }
    });

    it('handles cookie value containing equals signs', async () => {
      await freshLoad();
      const data = { distinct_id: 'abc==' };
      document.cookie = `mp_tok_mixpanel=${encodeURIComponent(JSON.stringify(data))}`;

      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual(data);
    });
  });

  // ==========================================================================
  // 18. CSP nonce support
  // ==========================================================================
  describe('nonce config', () => {
    it('sets nonce attribute on script element when configured', async () => {
      await freshLoad({ token: 'tok123', nonce: 'abc123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const scriptArg = insertBeforeSpy!.mock.calls[0][0];
      expect(scriptArg.getAttribute('nonce')).toBe('abc123');
    });

    it('does not set nonce attribute when nonce is not configured', async () => {
      await freshLoad({ token: 'tok123' });
      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const scriptArg = insertBeforeSpy!.mock.calls[0][0];
      expect(scriptArg.getAttribute('nonce')).toBeNull();
    });
  });

  // ==========================================================================
  // 19. Loaded callback — logs success message
  // ==========================================================================
  describe('loaded callback — success log', () => {
    it('logs initialization success message', async () => {
      await freshLoad({ token: 'tok' });
      const logSpy = vi.spyOn(window.ppLib, 'log');

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(logSpy).toHaveBeenCalledWith('info', '[ppMixpanel] Initialized successfully');
    });
  });

  // ==========================================================================
  // 20. Loaded callback — custom cookie names
  // ==========================================================================
  describe('loaded callback — custom cookie names', () => {
    it('uses custom cookie names for userId, ipAddress, experiments', async () => {
      setCookie('customUserId', 'u1');
      setCookie('customIp', '1.2.3.4');
      setCookie('customExp', JSON.stringify({ test: 'yes' }));

      const loadedCallback = await initAndGetLoadedCallback({
        cookieNames: {
          userId: 'customUserId',
          ipAddress: 'customIp',
          experiments: 'customExp',
        },
      });

      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ pp_user_id: 'u1' }));
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ pp_user_ip: '1.2.3.4' }));
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ test: 'yes' }));
    });
  });

  // ==========================================================================
  // 21. Integration — full flow
  // ==========================================================================
  describe('integration', () => {
    it('full flow: configure, init, loaded callback with all cookies and UTM params', async () => {
      setCookie('userId', 'user-99');
      setCookie('ipAddress', '10.0.0.1');
      setCookie('exp', JSON.stringify({ exp_a: 'v1' }));

      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/?utm_source=fb&utm_medium=social&gclid=g1&fbclid=f1',
        writable: true,
        configurable: true,
      });

      const loadedCallback = await initAndGetLoadedCallback({ projectName: 'IntegrationTest' });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.opt_in_tracking).toHaveBeenCalled();
      expect(mp.get_property('session ID')).toBeDefined();
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ project: 'IntegrationTest' }));
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ pp_user_id: 'user-99' }));
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ pp_user_ip: '10.0.0.1' }));
      expect(mp.register).toHaveBeenCalledWith(expect.objectContaining({ exp_a: 'v1' }));
      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({
          'utm_source [last touch]': 'fb',
          'utm_medium [last touch]': 'social',
          gclid: 'g1',
          fbclid: 'f1',
        })
      );

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('multiple track calls maintain session continuity within timeout', async () => {
      const loadedCallback = await initAndGetLoadedCallback({ sessionTimeout: 1800000 });
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const sessionId = mp.get_property('session ID');

      mp.track('Event 1');
      expect(mp.get_property('session ID')).toBe(sessionId);

      mp.track('Event 2');
      expect(mp.get_property('session ID')).toBe(sessionId);

      mp.track('Event 3');
      expect(mp.get_property('session ID')).toBe(sessionId);
    });

    it('calling init twice does not reload SDK (guard on __SV)', async () => {
      await freshLoad({ token: 'tok' });
      setupScriptEnv();

      window.ppLib.mixpanel.init();
      const firstCallCount = insertBeforeSpy!.mock.calls.length;

      window.ppLib.mixpanel.init();
      const secondCallCount = insertBeforeSpy!.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  // ==========================================================================
  // 22. Loaded callback — VWO experiment props polling
  // ==========================================================================
  describe('loaded callback — VWO experiment props deferred', () => {
    it('polls for VWO experiment props and registers when available', async () => {
      vi.useFakeTimers();
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      // No VWO props at load time
      invokeLoadedCallback(loadedCallback, mp);
      expect((window.ppLib as any)._vwoExperimentProps).toBeUndefined();

      // Simulate VWO module setting props after 1.5 seconds
      vi.advanceTimersByTime(1000);
      (window.ppLib as any)._vwoExperimentProps = {
        vwo_experiments: '72:Control',
        vwo_campaign_72: 'Control',
      };
      vi.advanceTimersByTime(500);

      // Polling should have registered the props
      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ vwo_experiments: '72:Control' })
      );

      // Clean up
      delete (window.ppLib as any)._vwoExperimentProps;
      vi.useRealTimers();
    });

    it('polls for VWO props from sessionStorage when ppLib prop is not set', async () => {
      vi.useFakeTimers();
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      invokeLoadedCallback(loadedCallback, mp);

      // Simulate sessionStorage being set (by VWO module on another page)
      vi.advanceTimersByTime(500);
      sessionStorage.setItem('pp_vwo_exp_props', JSON.stringify({
        vwo_experiments: '42:Variation 1',
        vwo_campaign_42: 'Variation 1',
      }));
      vi.advanceTimersByTime(500);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ vwo_experiments: '42:Variation 1' })
      );

      sessionStorage.removeItem('pp_vwo_exp_props');
      vi.useRealTimers();
    });

    it('stops polling after 30 iterations without VWO props', async () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      invokeLoadedCallback(loadedCallback, mp);

      // Advance past all 30 polls
      vi.advanceTimersByTime(15000);
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it('registers VWO props via _vis_opt_queue callback', async () => {
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      invokeLoadedCallback(loadedCallback, mp);

      // Simulate VWO module setting props
      (window.ppLib as any)._vwoExperimentProps = {
        vwo_experiments: '99:Big CTA',
        vwo_campaign_99: 'Big CTA',
      };

      // Execute the _vis_opt_queue callback
      if (window._vis_opt_queue) {
        for (const fn of window._vis_opt_queue) fn();
      }

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ vwo_experiments: '99:Big CTA' })
      );

      delete (window.ppLib as any)._vwoExperimentProps;
    });

    it('registerVWOProps is idempotent — second call returns true without re-registering', async () => {
      vi.useFakeTimers();
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      invokeLoadedCallback(loadedCallback, mp);

      // Set VWO props and let first poll fire
      (window.ppLib as any)._vwoExperimentProps = {
        vwo_experiments: '42:V1',
      };
      vi.advanceTimersByTime(500);

      const registerCallCount = mp.register.mock.calls.filter(
        (c: any) => c[0] && c[0].vwo_experiments === '42:V1'
      ).length;

      // Second poll should not re-register
      vi.advanceTimersByTime(500);

      const afterCallCount = mp.register.mock.calls.filter(
        (c: any) => c[0] && c[0].vwo_experiments === '42:V1'
      ).length;

      expect(afterCallCount).toBe(registerCallCount);

      delete (window.ppLib as any)._vwoExperimentProps;
      vi.useRealTimers();
    });

    it('VWO deferred registration handles errors gracefully', async () => {
      vi.useFakeTimers();
      const loadedCallback = await initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      invokeLoadedCallback(loadedCallback, mp);

      // Set props but make register throw
      (window.ppLib as any)._vwoExperimentProps = {
        vwo_experiments: '42:V1',
      };
      mp.register = vi.fn(() => { throw new Error('register failed'); });
      vi.advanceTimersByTime(500);

      // Should not throw, just log warning
      delete (window.ppLib as any)._vwoExperimentProps;
      vi.useRealTimers();
    });

    it('skips VWO polling when props are already set at load time', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      // Set VWO props BEFORE mixpanel init
      await freshLoad({ token: 'test-token-abc' });
      (window.ppLib as any)._vwoExperimentProps = {
        vwo_experiments: '42:V1',
      };

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = (window as any).mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // Should have registered immediately, no 500ms poll interval
      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ vwo_experiments: '42:V1' })
      );
      const pollCalls = setIntervalSpy.mock.calls.filter(c => c[1] === 500);
      expect(pollCalls.length).toBe(0);

      setIntervalSpy.mockRestore();
      delete (window.ppLib as any)._vwoExperimentProps;
      vi.useRealTimers();
    });
  });
});
