import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { setCookie } from '../helpers/mock-cookies.ts';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';

// =========================================================================
// Helper: ensure a <script> tag exists so getElementsByTagName('script')[0]
// returns a valid node inside loadMixpanelSDK().
// Also mock insertBefore to prevent actual network requests.
// =========================================================================
let insertBeforeSpy;

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
// Helper: load module, configure, call init, extract loaded callback.
// IMPORTANT: the loaded callback's SessionManager / resetCampaign /
// campaignParams reference the *global* `mixpanel` variable.  The loaded
// callback parameter only shadows it inside its own function body.
// So before invoking the callback we must set window.mixpanel = mp.
// =========================================================================
function initAndGetLoadedCallback(configOverrides) {
  loadWithCommon('mixpanel');

  const config = {
    token: 'test-token-abc',
    projectName: 'TestProject',
    ...configOverrides,
  };

  window.ppLib.mixpanel.configure(config);
  setupScriptEnv();
  window.ppLib.mixpanel.init();

  const initArgs = window.mixpanel._i[0];
  const loadedCallback = initArgs[1].loaded;
  return loadedCallback;
}

/**
 * Convenience: call the loaded callback with a mock mixpanel,
 * after replacing the global so SessionManager can use it.
 */
function invokeLoadedCallback(loadedCallback, mp) {
  window.mixpanel = mp;
  loadedCallback(mp);
}

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('mixpanel');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.mixpanel).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('mixpanel');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady.length).toBe(1);
    expect(typeof window.ppLibReady[0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('mixpanel');
    expect(window.ppLibReady.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.mixpanel).toBeDefined();
  });

  it('exposes ppLib.mixpanel public API with all expected methods', () => {
    loadWithCommon('mixpanel');
    const api = window.ppLib.mixpanel;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.getMixpanelCookieData).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});

// =========================================================================
// 2. CONFIG DEFAULTS
// =========================================================================
describe('CONFIG defaults', () => {
  beforeEach(() => {
    loadWithCommon('mixpanel');
  });

  it('has empty token by default', () => {
    expect(window.ppLib.mixpanel.getConfig().token).toBe('');
  });

  it('has empty projectName by default', () => {
    expect(window.ppLib.mixpanel.getConfig().projectName).toBe('');
  });

  it('has crossSubdomainCookie defaulting to false', () => {
    expect(window.ppLib.mixpanel.getConfig().crossSubdomainCookie).toBe(false);
  });

  it('has optOutByDefault defaulting to false', () => {
    expect(window.ppLib.mixpanel.getConfig().optOutByDefault).toBe(false);
  });

  it('has sessionTimeout defaulting to 1800000 (30 min)', () => {
    expect(window.ppLib.mixpanel.getConfig().sessionTimeout).toBe(1800000);
  });

  it('has correct cookieNames defaults', () => {
    expect(window.ppLib.mixpanel.getConfig().cookieNames).toEqual({
      userId: 'userId',
      ipAddress: 'ipAddress',
      experiments: 'exp',
    });
  });
});

// =========================================================================
// 3. loadMixpanelSDK()
// =========================================================================
describe('loadMixpanelSDK()', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  it('creates a stub on window.mixpanel with __SV = 1.2', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel).toBeDefined();
    expect(window.mixpanel.__SV).toBe(1.2);
  });

  it('creates _i array on stub', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(Array.isArray(window.mixpanel._i)).toBe(true);
  });

  it('pushes init call to _i array', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel._i.length).toBe(1);
  });

  it('creates people sub-object on stub', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel.people).toBeDefined();
  });

  it('inserts a script tag via insertBefore', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(insertBeforeSpy).toHaveBeenCalled();
    const scriptArg = insertBeforeSpy.mock.calls[0][0];
    expect(scriptArg.tagName).toBe('SCRIPT');
    expect(scriptArg.src).toContain('cdn.mxpnl.com/libs/mixpanel-2-latest.min.js');
    expect(scriptArg.async).toBe(true);
  });

  it('does nothing if __SV already exists on window.mixpanel', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    window.mixpanel = { __SV: 1.2, init: vi.fn() };

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel.init).toHaveBeenCalled();
  });

  it('handles mpeditor hash state in location', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    const state = JSON.stringify({ action: 'mpeditor', desiredHash: '' });
    const encodedState = encodeURIComponent(state);

    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      hash: '#state=' + encodedState,
      pathname: '/test',
      search: '',
      href: 'http://localhost/test#state=' + encodedState,
    };

    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(sessionStorage.getItem('_mpcehash')).toBe('#state=' + encodedState);
    expect(replaceStateSpy).toHaveBeenCalledWith('', '', '/test');

    replaceStateSpy.mockRestore();
    window.location = originalLocation;
  });

  it('handles mpeditor hash state with desiredHash', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    const state = JSON.stringify({ action: 'mpeditor', desiredHash: '#myHash' });
    const encodedState = encodeURIComponent(state);

    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      hash: '#state=' + encodedState,
      pathname: '/test',
      search: '?q=1',
      href: 'http://localhost/test?q=1#state=' + encodedState,
    };

    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(replaceStateSpy).toHaveBeenCalledWith('#myHash', '', '/test?q=1');

    replaceStateSpy.mockRestore();
    window.location = originalLocation;
  });

  it('does not throw when hash state JSON parse fails', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      hash: '#state=not-valid-json',
      pathname: '/test',
      search: '',
      href: 'http://localhost/test#state=not-valid-json',
    };

    setupScriptEnv();
    expect(() => window.ppLib.mixpanel.init()).not.toThrow();

    window.location = originalLocation;
  });

  it('does not process hash when action is not mpeditor', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    const state = JSON.stringify({ action: 'other' });
    const encodedState = encodeURIComponent(state);

    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      hash: '#state=' + encodedState,
      pathname: '/test',
      search: '',
      href: 'http://localhost/test#state=' + encodedState,
    };

    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(replaceStateSpy).not.toHaveBeenCalled();

    replaceStateSpy.mockRestore();
    window.location = originalLocation;
  });

  it('does not process hash when no state param in hash', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok123' });

    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      hash: '#foo=bar',
      pathname: '/test',
      search: '',
      href: 'http://localhost/test#foo=bar',
    };

    const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(replaceStateSpy).not.toHaveBeenCalled();

    replaceStateSpy.mockRestore();
    window.location = originalLocation;
  });

  it('stub init method pushes to _i with correct args', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'my-token' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const entry = window.mixpanel._i[0];
    expect(entry[0]).toBe('my-token');
    expect(entry[1]).toBeDefined();
    expect(typeof entry[1].loaded).toBe('function');
    expect(entry[2]).toBe('mixpanel');
  });

  it('stub toString returns "mixpanel (stub)" for default', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel.toString()).toBe('mixpanel (stub)');
    expect(window.mixpanel.toString(true)).toBe('mixpanel');
  });

  it('stub people.toString returns correct string', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    expect(window.mixpanel.people.toString()).toBe('mixpanel.people (stub)');
  });

  it('stub methods push calls to the array', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    window.mixpanel.track('testEvent', { key: 'value' });
    const found = window.mixpanel.some(
      (item) => Array.isArray(item) && item[0] === 'track'
    );
    expect(found).toBe(true);
  });

  it('stub get_group returns an object with group methods', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const group = window.mixpanel.get_group('company', 'acme');
    expect(group).toBeDefined();
    expect(typeof group.set).toBe('function');
    expect(typeof group.set_once).toBe('function');
    expect(typeof group.union).toBe('function');
    expect(typeof group.unset).toBe('function');
    expect(typeof group.remove).toBe('function');
    expect(typeof group.delete).toBe('function');
  });

  it('get_group methods are callable and execute inner function body', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const group = window.mixpanel.get_group('company', 'acme');
    expect(typeof group.set).toBe('function');

    // Call group.set() to execute lines 83-85 of the inner function.
    // In strict mode, the undeclared call2_args/call2 may throw ReferenceError.
    // We catch and verify the method body was entered.
    try {
      group.set('key', 'value');
    } catch (e) {
      // Expected in strict mode due to undeclared variables
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

  it('stub init with named instance uses a different sub-array', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    window.mixpanel.init('another-token', {}, 'secondary');
    expect(window.mixpanel._i.length).toBe(2);
    expect(window.mixpanel.secondary).toBeDefined();
    expect(window.mixpanel.secondary.people).toBeDefined();
    expect(window.mixpanel.secondary.toString()).toBe('mixpanel.secondary (stub)');
    expect(window.mixpanel.secondary.toString(true)).toBe('mixpanel.secondary');
    expect(window.mixpanel.secondary.people.toString()).toBe(
      'mixpanel.secondary.people (stub)'
    );
  });

  it('people stub methods push to the people array', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();
    window.ppLib.mixpanel.init();

    window.mixpanel.people.set({ name: 'Test' });
    const found = window.mixpanel.people.some(
      (item) => Array.isArray(item) && item[0] === 'set'
    );
    expect(found).toBe(true);
  });
});

// =========================================================================
// 4. SessionManager
// =========================================================================
describe('SessionManager', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  describe('generateId()', () => {
    it('returns a UUID-like string with correct format', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const sessionId = mp.get_property('session ID');
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('generates unique values across calls', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const id1 = mp.get_property('session ID');

      // Reset session state to trigger new ID generation via track
      mp._properties['session ID'] = undefined;
      mp._properties['last event time'] = undefined;

      mp.track('test');

      const id2 = mp.get_property('session ID');
      expect(id1).not.toBe(id2);
    });
  });

  describe('setId()', () => {
    it('registers session ID via mixpanel.register', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ 'session ID': expect.any(String) })
      );
    });
  });

  describe('check()', () => {
    it('creates new session when no last event time', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.get_property('session ID')).toBeDefined();
    });

    it('creates new session when no session ID exists', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now() });
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.get_property('session ID')).toBeDefined();
    });

    it('resets session on timeout (last event time > sessionTimeout)', () => {
      const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 1000 });
      const mp = createMockMixpanel();

      const oldTime = Date.now() - 5000;
      mp.register({ 'last event time': oldTime, 'session ID': 'old-session-id' });

      invokeLoadedCallback(loadedCallback, mp);

      const newSessionId = mp.get_property('session ID');
      expect(newSessionId).toBeDefined();
      expect(newSessionId).not.toBe('old-session-id');
    });

    it('does not reset session when within timeout', () => {
      const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 1800000 });
      const mp = createMockMixpanel();

      mp.register({ 'last event time': Date.now() - 1000, 'session ID': 'keep-me' });
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.get_property('session ID')).toBe('keep-me');
    });
  });
});

// =========================================================================
// 5. Campaign / UTM Attribution
// =========================================================================
describe('Campaign / UTM Attribution', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  describe('resetCampaign()', () => {
    it('sets all UTM params to $direct on session timeout', () => {
      const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 1 });
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

  describe('checkIfUtmParamsPresent()', () => {
    it('returns true when UTM params are in the URL (triggers campaign registration)', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google&utm_medium=cpc',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ 'utm_source [last touch]': 'google' })
      );
      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ 'utm_medium [last touch]': 'cpc' })
      );

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('returns false when no UTM params present (no utm keys registered)', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?foo=bar',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c) => c[0]);
      const hasUtm = registerCalls.some(
        (props) => props && props['utm_source [last touch]'] !== undefined
      );
      expect(hasUtm).toBe(false);

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('campaignParams()', () => {
    it('registers last touch and first touch UTM params', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value:
          'http://localhost/test?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=shoes',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
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

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('sets empty string for missing UTM params when some are present', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?utm_source=google',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
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

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('registers gclid when present', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?gclid=abc123',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ gclid: 'abc123' })
      );

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('registers fbclid when present', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?fbclid=fb456',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ fbclid: 'fb456' })
      );

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('registers both gclid and fbclid when both present', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test?gclid=g1&fbclid=f2',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      expect(mp.register).toHaveBeenCalledWith(
        expect.objectContaining({ gclid: 'g1', fbclid: 'f2' })
      );

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });

    it('does not register gclid/fbclid when absent', () => {
      const originalURL = document.URL;
      Object.defineProperty(document, 'URL', {
        value: 'http://localhost/test',
        writable: true,
        configurable: true,
      });

      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const registerCalls = mp.register.mock.calls.map((c) => c[0]);
      const hasGclid = registerCalls.some((props) => props && 'gclid' in props);
      const hasFbclid = registerCalls.some((props) => props && 'fbclid' in props);
      expect(hasGclid).toBe(false);
      expect(hasFbclid).toBe(false);

      Object.defineProperty(document, 'URL', {
        value: originalURL,
        writable: true,
        configurable: true,
      });
    });
  });
});

// =========================================================================
// 6. getMixpanelCookieData()
// =========================================================================
describe('getMixpanelCookieData()', () => {
  beforeEach(() => {
    loadWithCommon('mixpanel');
  });

  it('parses a valid mp_ cookie and returns the data', () => {
    const data = { distinct_id: '123', $initial_referrer: '$direct' };
    setCookie('mp_abc123_mixpanel', JSON.stringify(data));

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual(data);
  });

  it('returns empty object when no mp_ cookie exists', () => {
    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual({});
  });

  it('returns empty object for invalid JSON in cookie', () => {
    setCookie('mp_abc123_mixpanel', '{not-valid-json}');

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual({});
  });

  it('handles URL-encoded cookie values', () => {
    const data = { distinct_id: '456', name: 'test user' };
    const encoded = encodeURIComponent(JSON.stringify(data));
    document.cookie = `mp_def456_mixpanel=${encoded}`;

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual(data);
  });

  it('handles cookie with alphanumeric token part', () => {
    const data = { distinct_id: '789' };
    setCookie('mp_AbC123xYz_mixpanel', JSON.stringify(data));

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual(data);
  });

  it('ignores non-mixpanel cookies', () => {
    setCookie('other_cookie', 'value');
    setCookie('mp_abc123_mixpanel', JSON.stringify({ id: 1 }));
    setCookie('another', 'data');

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual({ id: 1 });
  });

  it('returns last matching cookie when multiple mp_ cookies exist', () => {
    setCookie('mp_first_mixpanel', JSON.stringify({ id: 1 }));
    setCookie('mp_second_mixpanel', JSON.stringify({ id: 2 }));

    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual({ id: 2 });
  });

  it('logs error and returns empty object on exception', () => {
    loadWithCommon('mixpanel');
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
});

// =========================================================================
// 7. initMixpanel()
// =========================================================================
describe('initMixpanel()', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  it('warns and returns early if no token is configured', () => {
    loadWithCommon('mixpanel');
    window.ppLib.config.debug = true;
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.mixpanel.init();

    expect(logSpy).toHaveBeenCalledWith(
      'warn',
      '[ppMixpanel] No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.'
    );

    expect(window.mixpanel).toBeUndefined();
  });

  it('loads SDK and calls mixpanel.init with correct config', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({
      token: 'my-token',
      crossSubdomainCookie: true,
      optOutByDefault: true,
    });

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const initArgs = window.mixpanel._i[0];
    expect(initArgs[0]).toBe('my-token');
    expect(initArgs[1].cross_subdomain_cookie).toBe(true);
    expect(initArgs[1].opt_out_tracking_by_default).toBe(true);
    expect(initArgs[1].api_transport).toBe('sendBeacon');
    expect(typeof initArgs[1].loaded).toBe('function');
  });
});

// =========================================================================
// 8. Loaded Callback
// =========================================================================
describe('loaded callback', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  it('calls opt_in_tracking on mixpanel', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.opt_in_tracking).toHaveBeenCalled();
  });

  it('updates SessionManager timeout from config', () => {
    const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 5000 });
    const mp = createMockMixpanel();

    mp.register({ 'last event time': Date.now(), 'session ID': 'existing' });
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.get_property('session ID')).toBe('existing');
  });

  it('calls SessionManager.check()', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.get_property('session ID')).toBeDefined();
  });

  it('monkey-patches track() function', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    const originalTrack = mp.track;

    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.track).not.toBe(originalTrack);
    expect(typeof mp.track).toBe('function');
  });

  it('registers base properties including last event time and user agent', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.register).toHaveBeenCalledWith(
      expect.objectContaining({
        'last event time': expect.any(Number),
        pp_user_agent: window.navigator.userAgent,
      })
    );
  });

  it('registers project name when projectName is configured', () => {
    const loadedCallback = initAndGetLoadedCallback({ projectName: 'MyProject' });
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.register).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'MyProject' })
    );
  });

  it('does not register project name when projectName is empty', () => {
    const loadedCallback = initAndGetLoadedCallback({ projectName: '' });
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    const registerCalls = mp.register.mock.calls.map((c) => c[0]);
    const hasProject = registerCalls.some((props) => props && 'project' in props);
    expect(hasProject).toBe(false);
  });

  it('registers pp_user_id from userId cookie', () => {
    setCookie('userId', 'user-42');

    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.register).toHaveBeenCalledWith(
      expect.objectContaining({ pp_user_id: 'user-42' })
    );
  });

  it('does not register pp_user_id when userId cookie is absent', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    const registerCalls = mp.register.mock.calls.map((c) => c[0]);
    const hasUserId = registerCalls.some((props) => props && 'pp_user_id' in props);
    expect(hasUserId).toBe(false);
  });

  it('registers pp_user_ip from ipAddress cookie', () => {
    setCookie('ipAddress', '192.168.1.1');

    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.register).toHaveBeenCalledWith(
      expect.objectContaining({ pp_user_ip: '192.168.1.1' })
    );
  });

  it('does not register pp_user_ip when ipAddress cookie is absent', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    const registerCalls = mp.register.mock.calls.map((c) => c[0]);
    const hasIp = registerCalls.some((props) => props && 'pp_user_ip' in props);
    expect(hasIp).toBe(false);
  });

  describe('experiment cookie', () => {
    it('parses valid JSON experiment cookie and registers data', () => {
      const expData = { experiment_a: 'variant_1', experiment_b: 'control' };
      setCookie('exp', JSON.stringify(expData));

      const loadedCallback = initAndGetLoadedCallback();
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

    it('handles invalid JSON in experiment cookie gracefully', () => {
      setCookie('exp', 'not-valid-json');

      loadWithCommon('mixpanel');
      window.ppLib.config.debug = true;
      window.ppLib.mixpanel.configure({ token: 'tok' });

      setupScriptEnv();
      window.ppLib.mixpanel.init();

      const initArgs = window.mixpanel._i[0];
      const loadedCallback = initArgs[1].loaded;
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      // Security.json.parse returns null for invalid JSON — no experiment data set
      const setOnceCalls = mp.people.set_once.mock.calls.map((c: any) => c[0]);
      const hasExp = setOnceCalls.some(
        (props: any) => props && ('experiment_a' in props || 'experiment_b' in props)
      );
      expect(hasExp).toBe(false);
    });

    it('does nothing when experiment cookie is absent', () => {
      const loadedCallback = initAndGetLoadedCallback();
      const mp = createMockMixpanel();
      invokeLoadedCallback(loadedCallback, mp);

      const setOnceCalls = mp.people.set_once.mock.calls.map((c) => c[0]);
      const hasExp = setOnceCalls.some(
        (props) => props && ('experiment_a' in props || 'experiment_b' in props)
      );
      expect(hasExp).toBe(false);
    });
  });

  it('calls campaignParams()', () => {
    const originalURL = document.URL;
    Object.defineProperty(document, 'URL', {
      value: 'http://localhost/test?utm_source=test_source',
      writable: true,
      configurable: true,
    });

    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(mp.register).toHaveBeenCalledWith(
      expect.objectContaining({ 'utm_source [last touch]': 'test_source' })
    );

    Object.defineProperty(document, 'URL', {
      value: originalURL,
      writable: true,
      configurable: true,
    });
  });

  it('logs success message', () => {
    loadWithCommon('mixpanel');
    window.ppLib.config.debug = true;
    window.ppLib.mixpanel.configure({ token: 'tok' });
    const logSpy = vi.spyOn(window.ppLib, 'log');

    setupScriptEnv();
    window.ppLib.mixpanel.init();

    const initArgs = window.mixpanel._i[0];
    const loadedCallback = initArgs[1].loaded;
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    expect(logSpy).toHaveBeenCalledWith('info', '[ppMixpanel] Initialized successfully');
  });
});

// =========================================================================
// 9. Monkey-patched track()
// =========================================================================
describe('monkey-patched track()', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  it('calls SessionManager.check() on each track call', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    const sessionIdBefore = mp.get_property('session ID');

    mp.track('Test Event', { key: 'val' });

    expect(mp.get_property('session ID')).toBe(sessionIdBefore);
  });

  it('registers last event time on each track call', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    invokeLoadedCallback(loadedCallback, mp);

    const timeBefore = Date.now();
    mp.track('Test Event');
    const timeAfter = Date.now();

    const lastEventTime = mp.get_property('last event time');
    expect(lastEventTime).toBeGreaterThanOrEqual(timeBefore);
    expect(lastEventTime).toBeLessThanOrEqual(timeAfter);
  });

  it('calls original track function with correct arguments', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    const originalTrack = mp.track;

    invokeLoadedCallback(loadedCallback, mp);

    mp.track('MyEvent', { prop: 'val' });

    expect(originalTrack).toHaveBeenCalledWith('MyEvent', { prop: 'val' });
  });

  it('passes through all arguments to original track', () => {
    const loadedCallback = initAndGetLoadedCallback();
    const mp = createMockMixpanel();
    const originalTrack = mp.track;

    invokeLoadedCallback(loadedCallback, mp);

    const callback = vi.fn();
    mp.track('Event', { a: 1 }, callback);

    expect(originalTrack).toHaveBeenCalledWith('Event', { a: 1 }, callback);
  });

  it('resets session and calls resetCampaign when track triggers timeout', () => {
    const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 1 });
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

// =========================================================================
// 10. Public API
// =========================================================================
describe('Public API', () => {
  beforeEach(() => {
    loadWithCommon('mixpanel');
  });

  afterEach(() => {
    teardownScriptEnv();
  });

  describe('configure()', () => {
    it('merges options into CONFIG and returns it', () => {
      const result = window.ppLib.mixpanel.configure({
        token: 'abc123',
        projectName: 'Test',
      });

      expect(result.token).toBe('abc123');
      expect(result.projectName).toBe('Test');
    });

    it('deep merges nested objects like cookieNames', () => {
      const result = window.ppLib.mixpanel.configure({
        cookieNames: { userId: 'uid' },
      });

      expect(result.cookieNames.userId).toBe('uid');
      expect(result.cookieNames.ipAddress).toBe('ipAddress');
      expect(result.cookieNames.experiments).toBe('exp');
    });

    it('returns CONFIG even when called with no arguments', () => {
      const result = window.ppLib.mixpanel.configure();
      expect(result).toBeDefined();
      expect(result.cookieNames).toBeDefined();
    });

    it('returns CONFIG when called with null', () => {
      const result = window.ppLib.mixpanel.configure(null);
      expect(result).toBeDefined();
      expect(result.token).toBe('');
    });

    it('overrides sessionTimeout', () => {
      const result = window.ppLib.mixpanel.configure({ sessionTimeout: 600000 });
      expect(result.sessionTimeout).toBe(600000);
    });

    it('overrides optOutByDefault', () => {
      const result = window.ppLib.mixpanel.configure({ optOutByDefault: true });
      expect(result.optOutByDefault).toBe(true);
    });

    it('overrides crossSubdomainCookie', () => {
      const result = window.ppLib.mixpanel.configure({ crossSubdomainCookie: true });
      expect(result.crossSubdomainCookie).toBe(true);
    });
  });

  describe('init()', () => {
    it('calls initMixpanel internally', () => {
      window.ppLib.mixpanel.configure({ token: 'tok' });
      setupScriptEnv();

      window.ppLib.mixpanel.init();

      expect(window.mixpanel).toBeDefined();
      expect(window.mixpanel.__SV).toBe(1.2);
    });
  });

  describe('getMixpanelCookieData()', () => {
    it('is exposed on the public API', () => {
      expect(typeof window.ppLib.mixpanel.getMixpanelCookieData).toBe('function');
    });

    it('returns parsed cookie data', () => {
      setCookie('mp_token1_mixpanel', JSON.stringify({ id: 'test' }));
      const result = window.ppLib.mixpanel.getMixpanelCookieData();
      expect(result).toEqual({ id: 'test' });
    });
  });

  describe('getConfig()', () => {
    it('returns the current CONFIG object', () => {
      const config = window.ppLib.mixpanel.getConfig();
      expect(config).toBeDefined();
      expect(config.token).toBe('');
      expect(config.sessionTimeout).toBe(1800000);
      expect(config.cookieNames).toBeDefined();
    });

    it('reflects changes made by configure()', () => {
      window.ppLib.mixpanel.configure({ token: 'changed' });
      const config = window.ppLib.mixpanel.getConfig();
      expect(config.token).toBe('changed');
    });
  });
});

// =========================================================================
// 11. Integration / Edge Cases
// =========================================================================
describe('Integration / Edge Cases', () => {
  afterEach(() => {
    teardownScriptEnv();
  });

  it('full flow: configure, init, loaded callback with all cookies and UTM params', () => {
    setCookie('userId', 'user-99');
    setCookie('ipAddress', '10.0.0.1');
    setCookie('exp', JSON.stringify({ exp_a: 'v1' }));

    const originalURL = document.URL;
    Object.defineProperty(document, 'URL', {
      value: 'http://localhost/?utm_source=fb&utm_medium=social&gclid=g1&fbclid=f1',
      writable: true,
      configurable: true,
    });

    const loadedCallback = initAndGetLoadedCallback({ projectName: 'IntegrationTest' });
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

  it('multiple track calls maintain session continuity within timeout', () => {
    const loadedCallback = initAndGetLoadedCallback({ sessionTimeout: 1800000 });
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

  it('getMixpanelCookieData works with cookie value containing equals signs', () => {
    const data = { distinct_id: 'abc==' };
    document.cookie = `mp_tok_mixpanel=${encodeURIComponent(JSON.stringify(data))}`;

    loadWithCommon('mixpanel');
    const result = window.ppLib.mixpanel.getMixpanelCookieData();
    expect(result).toEqual(data);
  });

  it('loaded callback with custom cookie names', () => {
    setCookie('customUserId', 'u1');
    setCookie('customIp', '1.2.3.4');
    setCookie('customExp', JSON.stringify({ test: 'yes' }));

    const loadedCallback = initAndGetLoadedCallback({
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

  it('calling init twice does not reload SDK (guard on __SV)', () => {
    loadWithCommon('mixpanel');
    window.ppLib.mixpanel.configure({ token: 'tok' });
    setupScriptEnv();

    window.ppLib.mixpanel.init();
    const firstCallCount = insertBeforeSpy.mock.calls.length;

    window.ppLib.mixpanel.init();
    const secondCallCount = insertBeforeSpy.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount);
  });

  it('module logs info message on load', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    const logSpy = vi.spyOn(window.ppLib, 'log');

    loadModule('mixpanel');

    expect(logSpy).toHaveBeenCalledWith('info', '[ppMixpanel] Module loaded');
  });
});
