import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { setCookie, clearAllCookies } from '../helpers/mock-cookies.ts';
import { createLoginDOM } from '../helpers/mock-dom.ts';

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('login');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.login).toBeDefined();
    expect(typeof window.logoutUser).toBe('function');
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('login');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady.length).toBe(1);
    expect(typeof window.ppLibReady[0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('login');
    expect(window.ppLibReady.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.login).toBeDefined();
    expect(typeof window.logoutUser).toBe('function');
  });

  it('exposes ppLib.login public API with all expected methods', () => {
    loadWithCommon('login');
    const api = window.ppLib.login;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.isLoggedIn).toBe('function');
    expect(typeof api.logout).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });

  it('exposes window.logoutUser globally', () => {
    loadWithCommon('login');
    expect(typeof window.logoutUser).toBe('function');
  });
});

// =========================================================================
// 2. AUTO-INITIALIZATION
// =========================================================================
describe('Auto-initialization', () => {
  afterEach(() => {
    // Restore readyState to 'complete' so subsequent tests are not affected
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
      configurable: true,
    });
  });

  it('runs init immediately when readyState is not "loading"', () => {
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
      configurable: true,
    });

    loadWithCommon('login');

    expect(document.body.classList.contains('dom-ready')).toBe(true);
  });

  it('defers to DOMContentLoaded when readyState is "loading"', () => {
    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      writable: true,
      configurable: true,
    });

    const addEventSpy = vi.spyOn(document, 'addEventListener');

    loadWithCommon('login');

    expect(document.body.classList.contains('dom-ready')).toBe(false);

    const dclCall = addEventSpy.mock.calls.find(
      (c) => c[0] === 'DOMContentLoaded'
    );
    expect(dclCall).toBeDefined();

    dclCall[1]();

    expect(document.body.classList.contains('dom-ready')).toBe(true);

    addEventSpy.mockRestore();
  });
});

// =========================================================================
// 3. CONFIG DEFAULTS
// =========================================================================
describe('CONFIG defaults', () => {
  beforeEach(() => {
    loadWithCommon('login');
  });

  it('has correct cookie name defaults', () => {
    const config = window.ppLib.login.getConfig();
    expect(config.cookieNames).toEqual({
      userId: 'userId',
      patientId: 'patientId',
      auth: 'Authorization',
      appAuth: 'app_is_authenticated',
      prevUser: 'previousUser',
      firstName: 'firstName',
    });
  });

  it('has correct bodyClasses defaults', () => {
    const config = window.ppLib.login.getConfig();
    expect(config.bodyClasses).toEqual({
      loggedIn: 'is-logged-in',
      loggedOut: 'is-logged-out',
      signupCompleted: 'signup-completed',
      hasPreviousUser: 'has-previous-user',
      domReady: 'dom-ready',
    });
  });

  it('has correct identifierAttribute', () => {
    expect(window.ppLib.login.getConfig().identifierAttribute).toBe(
      'data-login-identifier-key'
    );
  });

  it('has correct actionAttribute', () => {
    expect(window.ppLib.login.getConfig().actionAttribute).toBe('data-action');
  });

  it('has reloadOnLogout defaulting to true', () => {
    expect(window.ppLib.login.getConfig().reloadOnLogout).toBe(true);
  });
});

// =========================================================================
// 4. logoutUser()
// =========================================================================
describe('logoutUser()', () => {
  beforeEach(() => {
    loadWithCommon('login');
    // Disable reload by default so tests don't trigger jsdom navigation
    window.ppLib.login.configure({ reloadOnLogout: false });
  });

  describe('soft logout (false)', () => {
    it('deletes userId, patientId, Authorization, app_is_authenticated cookies', () => {
      setCookie('userId', '123');
      setCookie('patientId', '456');
      setCookie('Authorization', 'tok123');
      setCookie('app_is_authenticated', 'true');
      setCookie('previousUser', '{"firstName":"Jane"}');
      setCookie('firstName', 'Jane');

      window.logoutUser(false);

      expect(window.ppLib.getCookie('userId')).toBeNull();
      expect(window.ppLib.getCookie('patientId')).toBeNull();
      expect(window.ppLib.getCookie('Authorization')).toBeNull();
      expect(window.ppLib.getCookie('app_is_authenticated')).toBeNull();
    });

    it('does NOT delete previousUser and firstName cookies', () => {
      setCookie('previousUser', '{"firstName":"Jane"}');
      setCookie('firstName', 'Jane');

      window.logoutUser(false);

      expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
      expect(window.ppLib.getCookie('firstName')).not.toBeNull();
    });
  });

  describe('hard logout (true)', () => {
    it('deletes all session cookies PLUS previousUser and firstName', () => {
      setCookie('userId', '123');
      setCookie('patientId', '456');
      setCookie('Authorization', 'tok');
      setCookie('app_is_authenticated', 'true');
      setCookie('previousUser', '{"firstName":"Jane"}');
      setCookie('firstName', 'Jane');

      window.logoutUser(true);

      expect(window.ppLib.getCookie('userId')).toBeNull();
      expect(window.ppLib.getCookie('patientId')).toBeNull();
      expect(window.ppLib.getCookie('Authorization')).toBeNull();
      expect(window.ppLib.getCookie('app_is_authenticated')).toBeNull();
      expect(window.ppLib.getCookie('previousUser')).toBeNull();
      expect(window.ppLib.getCookie('firstName')).toBeNull();
    });
  });

  it('removes is-logged-in and signup-completed, adds is-logged-out', () => {
    document.body.classList.add('is-logged-in', 'signup-completed');

    window.logoutUser(false);

    expect(document.body.classList.contains('is-logged-in')).toBe(false);
    expect(document.body.classList.contains('signup-completed')).toBe(false);
    expect(document.body.classList.contains('is-logged-out')).toBe(true);
  });

  it('treats non-true hardLogout values as soft logout (undefined)', () => {
    setCookie('previousUser', '{"firstName":"Jane"}');
    setCookie('firstName', 'Jane');

    window.logoutUser(undefined);

    expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
    expect(window.ppLib.getCookie('firstName')).not.toBeNull();
  });

  it('treats string "true" as soft logout (not strictly true)', () => {
    setCookie('previousUser', '{"firstName":"Jane"}');
    setCookie('firstName', 'Jane');

    window.logoutUser('true');

    expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
    expect(window.ppLib.getCookie('firstName')).not.toBeNull();
  });

  it('treats 1 as soft logout', () => {
    setCookie('previousUser', '{"firstName":"Jane"}');
    setCookie('firstName', 'Jane');

    window.logoutUser(1);

    expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
    expect(window.ppLib.getCookie('firstName')).not.toBeNull();
  });

  it('treats null as soft logout', () => {
    setCookie('previousUser', '{"firstName":"Jane"}');
    setCookie('firstName', 'Jane');

    window.logoutUser(null);

    expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
    expect(window.ppLib.getCookie('firstName')).not.toBeNull();
  });

  it('handles errors gracefully when classList throws', () => {
    const origClassList = document.body.classList;
    Object.defineProperty(document.body, 'classList', {
      get() {
        throw new Error('classList broken');
      },
      configurable: true,
    });

    const logSpy = vi.spyOn(window.ppLib, 'log');

    expect(() => window.logoutUser(false)).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[ppLogin] Logout error',
      expect.any(Error)
    );

    Object.defineProperty(document.body, 'classList', {
      value: origClassList,
      writable: true,
      configurable: true,
    });
  });
});

// =========================================================================
// 5. initAuthState()
// =========================================================================
describe('initAuthState()', () => {
  function loadFresh() {
    loadWithCommon('login');
  }

  describe('logged-in detection', () => {
    it('adds is-logged-in when userId is valid and auth token present', () => {
      setCookie('userId', '42');
      setCookie('Authorization', 'Bearer_tok');
      loadFresh();

      expect(document.body.classList.contains('is-logged-in')).toBe(true);
      expect(document.body.classList.contains('is-logged-out')).toBe(false);
    });

    it('adds is-logged-out when userId is "-1"', () => {
      setCookie('userId', '-1');
      setCookie('Authorization', 'Bearer_tok');
      loadFresh();

      expect(document.body.classList.contains('is-logged-out')).toBe(true);
      expect(document.body.classList.contains('is-logged-in')).toBe(false);
    });

    it('adds is-logged-out when userId is missing', () => {
      setCookie('Authorization', 'Bearer_tok');
      loadFresh();

      expect(document.body.classList.contains('is-logged-out')).toBe(true);
    });

    it('adds is-logged-out when auth token is missing', () => {
      setCookie('userId', '42');
      loadFresh();

      expect(document.body.classList.contains('is-logged-out')).toBe(true);
    });

    it('adds is-logged-out when auth token is empty string', () => {
      setCookie('userId', '42');
      setCookie('Authorization', '');
      loadFresh();

      expect(document.body.classList.contains('is-logged-out')).toBe(true);
    });
  });

  describe('signup completion', () => {
    it('adds signup-completed when appAuth is "true"', () => {
      setCookie('app_is_authenticated', 'true');
      loadFresh();

      expect(document.body.classList.contains('signup-completed')).toBe(true);
    });

    it('does not add signup-completed when appAuth is absent', () => {
      loadFresh();

      expect(document.body.classList.contains('signup-completed')).toBe(false);
    });

    it('does not add signup-completed when appAuth is "false"', () => {
      setCookie('app_is_authenticated', 'false');
      loadFresh();

      expect(document.body.classList.contains('signup-completed')).toBe(false);
    });
  });

  describe('previous user detection', () => {
    it('adds has-previous-user and injects name from JSON previousUser cookie', () => {
      createLoginDOM({ nameElements: 2 });
      setCookie('previousUser', JSON.stringify({ firstName: 'Alice' }));
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(true);
      const spans = document.querySelectorAll(
        '[data-login-identifier-key="user-first-name"]'
      );
      spans.forEach((span) => {
        expect(span.textContent).toBe('Alice');
      });
    });

    it('adds has-previous-user with phone-only JSON (no firstName)', () => {
      setCookie('previousUser', JSON.stringify({ phone: '555-1234' }));
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(true);
    });

    it('overrides JSON name with firstName simple cookie', () => {
      createLoginDOM({ nameElements: 1 });
      setCookie('previousUser', JSON.stringify({ firstName: 'Alice' }));
      setCookie('firstName', 'Bob');
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(true);
      const span = document.querySelector(
        '[data-login-identifier-key="user-first-name"]'
      );
      expect(span.textContent).toBe('Bob');
    });

    it('sets has-previous-user from firstName cookie alone (no JSON)', () => {
      createLoginDOM({ nameElements: 1 });
      setCookie('firstName', 'Charlie');
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(true);
      const span = document.querySelector(
        '[data-login-identifier-key="user-first-name"]'
      );
      expect(span.textContent).toBe('Charlie');
    });

    it('sanitizes name before DOM injection to prevent XSS', () => {
      setCookie('previousUser', JSON.stringify({ firstName: '<script>alert(1)</script>' }));
      const span = document.createElement('span');
      span.setAttribute('data-login-identifier-key', 'user-first-name');
      document.body.appendChild(span);
      loadFresh();

      // Security.sanitize strips < > ' " characters
      expect(span.textContent).toBe('scriptalert(1)/script');
    });

    it('handles invalid JSON in previousUser gracefully', () => {
      setCookie('previousUser', '{not-valid-json');
      loadFresh();

      expect(document.body.classList.contains('dom-ready')).toBe(true);
      expect(document.body.classList.contains('has-previous-user')).toBe(false);
    });

    it('does not add has-previous-user when no previous user data exists', () => {
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(false);
    });

    it('handles previousUser JSON with neither firstName nor phone', () => {
      setCookie('previousUser', JSON.stringify({ email: 'x@y.com' }));
      loadFresh();

      expect(document.body.classList.contains('has-previous-user')).toBe(false);
    });
  });

  it('always adds dom-ready class', () => {
    loadFresh();
    expect(document.body.classList.contains('dom-ready')).toBe(true);
  });

  it('adds dom-ready even when logged in with all cookies', () => {
    setCookie('userId', '42');
    setCookie('Authorization', 'Bearer_tok');
    setCookie('app_is_authenticated', 'true');
    setCookie('previousUser', JSON.stringify({ firstName: 'Z' }));
    setCookie('firstName', 'Z');
    loadFresh();

    expect(document.body.classList.contains('dom-ready')).toBe(true);
  });

  it('handles error in initAuthState gracefully', () => {
    loadFresh();
    const origGetCookie = window.ppLib.getCookie;
    window.ppLib.getCookie = () => {
      throw new Error('getCookie explosion');
    };
    const logSpy = vi.spyOn(window.ppLib, 'log');

    expect(() => window.ppLib.login.init()).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[ppLogin] initAuthState error',
      expect.any(Error)
    );

    window.ppLib.getCookie = origGetCookie;
  });
});

// =========================================================================
// 6. bindActions()
// =========================================================================
describe('bindActions()', () => {
  it('logout button click calls logoutUser(false)', () => {
    createLoginDOM({ logoutButtons: 1 });
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: false });

    const btn = document.querySelector('[data-action="logout"]');
    btn.click();

    // After soft logout, is-logged-out should be present
    expect(document.body.classList.contains('is-logged-out')).toBe(true);
  });

  it('forget-me button click calls logoutUser(true)', () => {
    setCookie('previousUser', '{"firstName":"Zara"}');
    setCookie('firstName', 'Zara');
    createLoginDOM({ forgetButtons: 1 });
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: false });

    const btn = document.querySelector('[data-action="forget-me"]');
    btn.click();

    // Hard logout: previousUser + firstName deleted
    expect(window.ppLib.getCookie('previousUser')).toBeNull();
    expect(window.ppLib.getCookie('firstName')).toBeNull();
  });

  it('click handler calls preventDefault on the event', () => {
    createLoginDOM({ logoutButtons: 1 });
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: false });

    const btn = document.querySelector('[data-action="logout"]');

    // Add a second listener that checks defaultPrevented after the module's handler ran
    let wasDefaultPrevented = false;
    btn.addEventListener('click', (e) => {
      wasDefaultPrevented = e.defaultPrevented;
    });

    // Use dispatchEvent with a cancelable event
    const evt = new window.Event('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(evt);

    expect(wasDefaultPrevented).toBe(true);
  });

  it('handles multiple logout and forget-me buttons', () => {
    createLoginDOM({ logoutButtons: 2, forgetButtons: 2 });
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: false });

    const logoutBtns = document.querySelectorAll('[data-action="logout"]');
    const forgetBtns = document.querySelectorAll('[data-action="forget-me"]');

    expect(logoutBtns.length).toBe(2);
    expect(forgetBtns.length).toBe(2);

    logoutBtns.forEach((btn) => btn.click());
    forgetBtns.forEach((btn) => btn.click());
  });

  it('does not throw when no buttons exist in the DOM', () => {
    expect(() => loadWithCommon('login')).not.toThrow();
  });

  it('handles bindActions error gracefully', () => {
    loadWithCommon('login');
    const origQSA = document.querySelectorAll;
    document.querySelectorAll = () => {
      throw new Error('querySelectorAll broken');
    };

    const logSpy = vi.spyOn(window.ppLib, 'log');
    expect(() => window.ppLib.login.init()).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(
      'error',
      '[ppLogin] bindActions error',
      expect.any(Error)
    );

    document.querySelectorAll = origQSA;
  });
});

// =========================================================================
// 7. PUBLIC API
// =========================================================================
describe('Public API', () => {
  beforeEach(() => {
    loadWithCommon('login');
  });

  describe('configure()', () => {
    it('merges options into CONFIG and returns it', () => {
      const result = window.ppLib.login.configure({
        reloadOnLogout: false,
      });

      expect(result.reloadOnLogout).toBe(false);
      expect(result.cookieNames.userId).toBe('userId');
    });

    it('deep merges nested objects', () => {
      const result = window.ppLib.login.configure({
        cookieNames: { userId: 'uid' },
      });

      expect(result.cookieNames.userId).toBe('uid');
      expect(result.cookieNames.auth).toBe('Authorization');
    });

    it('returns CONFIG even when called with no arguments', () => {
      const result = window.ppLib.login.configure();
      expect(result).toBeDefined();
      expect(result.cookieNames).toBeDefined();
    });

    it('returns CONFIG when called with null', () => {
      const result = window.ppLib.login.configure(null);
      expect(result).toBeDefined();
      expect(result.cookieNames).toBeDefined();
    });
  });

  describe('init()', () => {
    it('re-runs initialization (initAuthState + bindActions)', () => {
      setCookie('userId', '99');
      setCookie('Authorization', 'tok');

      window.ppLib.login.init();

      expect(document.body.classList.contains('is-logged-in')).toBe(true);
    });
  });

  describe('isLoggedIn()', () => {
    it('returns true when userId and auth token are valid', () => {
      setCookie('userId', '42');
      setCookie('Authorization', 'Bearer_tok');

      expect(window.ppLib.login.isLoggedIn()).toBe(true);
    });

    it('returns false when userId is missing', () => {
      setCookie('Authorization', 'Bearer_tok');
      expect(window.ppLib.login.isLoggedIn()).toBe(false);
    });

    it('returns false when userId is "-1"', () => {
      setCookie('userId', '-1');
      setCookie('Authorization', 'Bearer_tok');

      expect(window.ppLib.login.isLoggedIn()).toBe(false);
    });

    it('returns false when auth token is missing', () => {
      setCookie('userId', '42');
      expect(window.ppLib.login.isLoggedIn()).toBe(false);
    });

    it('returns false when auth token is empty', () => {
      setCookie('userId', '42');
      setCookie('Authorization', '');

      expect(window.ppLib.login.isLoggedIn()).toBe(false);
    });

    it('returns false when no cookies are set', () => {
      expect(window.ppLib.login.isLoggedIn()).toBe(false);
    });
  });

  describe('logout()', () => {
    it('delegates to logoutUser for soft logout', () => {
      setCookie('previousUser', '{"firstName":"Eve"}');
      setCookie('firstName', 'Eve');
      window.ppLib.login.configure({ reloadOnLogout: false });

      window.ppLib.login.logout(false);

      expect(window.ppLib.getCookie('previousUser')).not.toBeNull();
      expect(window.ppLib.getCookie('firstName')).not.toBeNull();
      expect(document.body.classList.contains('is-logged-out')).toBe(true);
    });

    it('delegates to logoutUser for hard logout', () => {
      setCookie('previousUser', '{"firstName":"Eve"}');
      setCookie('firstName', 'Eve');
      window.ppLib.login.configure({ reloadOnLogout: false });

      window.ppLib.login.logout(true);

      expect(window.ppLib.getCookie('previousUser')).toBeNull();
      expect(window.ppLib.getCookie('firstName')).toBeNull();
    });
  });

  describe('getConfig()', () => {
    it('returns the current CONFIG object', () => {
      const config = window.ppLib.login.getConfig();
      expect(config).toBeDefined();
      expect(config.cookieNames).toBeDefined();
      expect(config.bodyClasses).toBeDefined();
      expect(config.identifierAttribute).toBe('data-login-identifier-key');
      expect(config.actionAttribute).toBe('data-action');
      expect(typeof config.reloadOnLogout).toBe('boolean');
    });

    it('reflects changes made by configure()', () => {
      window.ppLib.login.configure({ reloadOnLogout: false });
      const config = window.ppLib.login.getConfig();
      expect(config.reloadOnLogout).toBe(false);
    });
  });
});

// =========================================================================
// EDGE CASES / INTEGRATION
// =========================================================================
describe('Edge cases and integration', () => {
  it('full logged-in flow: userId + auth + appAuth + previousUser + firstName', () => {
    createLoginDOM({ nameElements: 1, logoutButtons: 1, forgetButtons: 1 });
    setCookie('userId', '100');
    setCookie('Authorization', 'Bearer_xyz');
    setCookie('app_is_authenticated', 'true');
    setCookie('previousUser', JSON.stringify({ firstName: 'Alice' }));
    setCookie('firstName', 'Bob');

    loadWithCommon('login');

    expect(document.body.classList.contains('is-logged-in')).toBe(true);
    expect(document.body.classList.contains('signup-completed')).toBe(true);
    expect(document.body.classList.contains('has-previous-user')).toBe(true);
    expect(document.body.classList.contains('dom-ready')).toBe(true);

    const span = document.querySelector(
      '[data-login-identifier-key="user-first-name"]'
    );
    expect(span.textContent).toBe('Bob');
  });

  it('full logged-out flow: no cookies at all', () => {
    loadWithCommon('login');

    expect(document.body.classList.contains('is-logged-out')).toBe(true);
    expect(document.body.classList.contains('is-logged-in')).toBe(false);
    expect(document.body.classList.contains('signup-completed')).toBe(false);
    expect(document.body.classList.contains('has-previous-user')).toBe(false);
    expect(document.body.classList.contains('dom-ready')).toBe(true);
  });

  it('logout then check isLoggedIn returns false', () => {
    setCookie('userId', '42');
    setCookie('Authorization', 'Bearer_tok');
    loadWithCommon('login');

    expect(window.ppLib.login.isLoggedIn()).toBe(true);

    window.ppLib.login.configure({ reloadOnLogout: false });
    window.ppLib.login.logout(false);

    expect(window.ppLib.login.isLoggedIn()).toBe(false);
  });

  it('previousUser JSON with empty object does not set has-previous-user', () => {
    setCookie('previousUser', JSON.stringify({}));
    loadWithCommon('login');

    expect(document.body.classList.contains('has-previous-user')).toBe(false);
  });

  it('previousUser JSON with null value does not set has-previous-user', () => {
    setCookie('previousUser', 'null');
    loadWithCommon('login');

    expect(document.body.classList.contains('has-previous-user')).toBe(false);
  });

  it('name elements receive empty string when previousUser has phone only', () => {
    createLoginDOM({ nameElements: 1 });
    setCookie('previousUser', JSON.stringify({ phone: '555-0000' }));
    loadWithCommon('login');

    const span = document.querySelector(
      '[data-login-identifier-key="user-first-name"]'
    );
    // previousUserName stays '' when only phone was present
    expect(span.textContent).toBe('');
  });

  it('no name elements in DOM does not cause error with previous user', () => {
    setCookie('previousUser', JSON.stringify({ firstName: 'Test' }));
    expect(() => loadWithCommon('login')).not.toThrow();
    expect(document.body.classList.contains('has-previous-user')).toBe(true);
  });
});

// =========================================================================
// RELOAD BEHAVIOR (placed last to avoid location mock pollution)
// These tests replace window.location and restore it carefully.
// =========================================================================
describe('logoutUser reload behavior', () => {
  it('calls location.reload when reloadOnLogout is true', () => {
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: true });

    const savedLocation = window.location;
    const reloadMock = vi.fn();
    delete window.location;
    window.location = { reload: reloadMock, pathname: '/' };

    window.logoutUser(false);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    window.location = savedLocation;
  });

  it('does NOT call location.reload when reloadOnLogout is false', () => {
    loadWithCommon('login');
    window.ppLib.login.configure({ reloadOnLogout: false });

    const savedLocation = window.location;
    const reloadMock = vi.fn();
    delete window.location;
    window.location = { reload: reloadMock, pathname: '/' };

    window.logoutUser(false);
    expect(reloadMock).not.toHaveBeenCalled();

    window.location = savedLocation;
  });
});
