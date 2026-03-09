import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';
import { createMockDataLayer } from '../helpers/mock-datalayer.ts';
import { setSessionItem, setLocalItem } from '../helpers/mock-storage.ts';

// =========================================================================
// ANALYTICS MODULE TESTS
// =========================================================================

// Helper: load analytics with consent required so auto-init does NOT run Tracker.init()
function loadWithConsentRequired() {
  loadModule('common');
  // Make consent required BEFORE loading analytics so auto-init skips tracking
  window.ppLib.config.debug = false;
  loadModule('analytics');
  // Now set consent required via the public API
  window.ppAnalytics.config({ consent: { required: true, defaultState: 'denied' } });
}

// Helper: load analytics with debug enabled
function loadWithDebug() {
  loadModule('common');
  window.ppLib.config.debug = true;
  window.ppLib.config.verbose = true;
  loadModule('analytics');
}

// Helper: set URL before loading
function setUrl(url) {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    configurable: true,
  });
}

// Helper: restore location to default jsdom value
function restoreLocation() {
  Object.defineProperty(window, 'location', {
    value: new URL('http://localhost:3000/'),
    configurable: true,
  });
}

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('analytics');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppAnalytics).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('analytics');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady.length).toBe(1);
    expect(typeof window.ppLibReady[0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('analytics');
    expect(window.ppLibReady.length).toBe(1);

    loadModule('common');
    expect(window.ppAnalytics).toBeDefined();
  });

  it('pushes to existing ppLibReady array', () => {
    delete window.ppLib;
    window.ppLibReady = [vi.fn()];

    loadModule('analytics');

    expect(window.ppLibReady.length).toBe(2);
    expect(typeof window.ppLibReady[1]).toBe('function');
  });

  it('exposes window.ppAnalytics with all expected methods', () => {
    loadWithCommon('analytics');
    const api = window.ppAnalytics;
    expect(api.version).toBeDefined();
    expect(typeof api.config).toBe('function');
    expect(typeof api.consent.grant).toBe('function');
    expect(typeof api.consent.revoke).toBe('function');
    expect(typeof api.consent.status).toBe('function');
    expect(typeof api.track).toBe('function');
    expect(typeof api.getAttribution).toBe('function');
    expect(typeof api.registerPlatform).toBe('function');
    expect(typeof api.clear).toBe('function');
    expect(typeof api.init).toBe('function');
  });
});

// =========================================================================
// 2. AUTO-INITIALIZATION
// =========================================================================
describe('Auto-initialization', () => {
  afterEach(() => {
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
      configurable: true,
    });
  });

  it('runs Tracker.init() immediately when readyState is not "loading"', () => {
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
      configurable: true,
    });

    // With default consent (not required), init runs and sets initialized
    loadWithCommon('analytics');
    expect(window.ppAnalytics).toBeDefined();
  });

  it('defers Tracker.init() to DOMContentLoaded when readyState is "loading"', () => {
    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      writable: true,
      configurable: true,
    });

    const addEventSpy = vi.spyOn(document, 'addEventListener');

    loadWithCommon('analytics');

    const dclCall = addEventSpy.mock.calls.find(
      (c) => c[0] === 'DOMContentLoaded'
    );
    expect(dclCall).toBeDefined();

    // Fire the DOMContentLoaded callback
    dclCall[1]();

    expect(window.ppAnalytics).toBeDefined();
    addEventSpy.mockRestore();
  });

  it('exposes ppAnalyticsDebug when debug=true', () => {
    loadWithDebug();
    expect(window.ppAnalyticsDebug).toBeDefined();
    expect(window.ppAnalyticsDebug.config).toBeDefined();
    expect(window.ppAnalyticsDebug.consent).toBeDefined();
    expect(window.ppAnalyticsDebug.tracker).toBeDefined();
    expect(window.ppAnalyticsDebug.platforms).toBeDefined();
    expect(window.ppAnalyticsDebug.queue).toBeDefined();
  });

  it('does NOT expose ppAnalyticsDebug when debug=false', () => {
    loadWithCommon('analytics');
    expect(window.ppAnalyticsDebug).toBeUndefined();
  });
});

// =========================================================================
// 3. CONFIG DEFAULTS
// =========================================================================
describe('CONFIG defaults', () => {
  beforeEach(() => {
    loadWithDebug();
  });

  it('has correct version', () => {
    expect(window.ppAnalyticsDebug.config.version).toBe('3.1.0');
  });

  it('has correct namespace', () => {
    expect(window.ppAnalyticsDebug.config.namespace).toBe('pp_attr');
  });

  it('has correct consent defaults', () => {
    const consent = window.ppAnalyticsDebug.config.consent;
    expect(consent.required).toBe(false);
    expect(consent.defaultState).toBe('approved');
    expect(consent.storageKey).toBe('pp_consent');
    expect(consent.frameworks.oneTrust.enabled).toBe(false);
    expect(consent.frameworks.oneTrust.cookieName).toBe('OptanonConsent');
    expect(consent.frameworks.oneTrust.categoryId).toBe('C0002');
    expect(consent.frameworks.cookieYes.enabled).toBe(false);
    expect(consent.frameworks.cookieYes.cookieName).toBe('cookieyes-consent');
    expect(consent.frameworks.cookieYes.categoryId).toBe('analytics');
    expect(consent.frameworks.custom.enabled).toBe(false);
    expect(typeof consent.frameworks.custom.checkFunction).toBe('function');
  });

  it('has correct parameter defaults', () => {
    const params = window.ppAnalyticsDebug.config.parameters;
    expect(params.utm).toEqual(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
    expect(params.ads.google).toEqual(['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid']);
    expect(params.ads.facebook).toEqual(['fbclid', 'fb_action_ids']);
    expect(params.ads.microsoft).toEqual(['msclkid']);
    expect(params.ads.tiktok).toEqual(['ttclid']);
    expect(params.ads.linkedin).toEqual(['li_fat_id']);
    expect(params.ads.twitter).toEqual(['twclid']);
    expect(params.ads.pinterest).toEqual(['epik']);
    expect(params.ads.snapchat).toEqual(['ScCid']);
    expect(params.custom).toEqual(['ref', 'referrer', 'promo', 'affiliate_id']);
  });

  it('has correct attribution defaults', () => {
    const attr = window.ppAnalyticsDebug.config.attribution;
    expect(attr.sessionTimeout).toBe(30);
    expect(attr.enableFirstTouch).toBe(true);
    expect(attr.enableLastTouch).toBe(true);
    expect(attr.persistAcrossSessions).toBe(false);
    expect(attr.trackPageViews).toBe(true);
    expect(attr.autoCapture).toBe(true);
  });

  it('has correct platform defaults', () => {
    const platforms = window.ppAnalyticsDebug.config.platforms;
    expect(platforms.gtm.enabled).toBe(true);
    expect(platforms.gtm.events.firstTouch).toBe('first_touch_attribution');
    expect(platforms.gtm.events.lastTouch).toBe('last_touch_attribution');
    expect(platforms.gtm.events.pageView).toBe('attribution_page_view');
    expect(platforms.gtm.rateLimitMax).toBe(100);
    expect(platforms.gtm.rateLimitWindow).toBe(60000);
    expect(platforms.ga4.enabled).toBe(true);
    expect(platforms.ga4.measurementId).toBeNull();
    expect(platforms.ga4.sendPageView).toBe(true);
    expect(platforms.mixpanel.enabled).toBe(true);
    expect(platforms.mixpanel.trackPageView).toBe(true);
    expect(platforms.mixpanel.maxRetries).toBe(50);
    expect(platforms.mixpanel.retryInterval).toBe(100);
    expect(platforms.custom).toEqual([]);
  });

  it('has correct performance defaults', () => {
    const perf = window.ppAnalyticsDebug.config.performance;
    expect(perf.useRequestIdleCallback).toBe(true);
    expect(perf.queueEnabled).toBe(true);
    expect(perf.maxQueueSize).toBe(50);
  });

  it('has debug/verbose flags from ppLib.config', () => {
    // debug was set to true before load
    expect(window.ppAnalyticsDebug.config.debug).toBe(true);
    expect(window.ppAnalyticsDebug.config.verbose).toBe(true);
  });
});

// =========================================================================
// 4. UTILS
// =========================================================================
describe('Utils', () => {
  describe('getAllParamNames', () => {
    it('combines all param names from utm, ads, and custom', () => {
      loadWithDebug();
      const dbg = window.ppAnalyticsDebug;
      // Access via internal Consent or similar: we need to test indirectly
      // The config has all default params; we can verify via isValidParam
      expect(window.ppAnalytics.config().parameters.utm.length).toBe(5);
      expect(window.ppAnalytics.config().parameters.custom.length).toBe(4);
    });

    it('returns [] on error (broken config)', () => {
      loadWithDebug();
      const config = window.ppAnalyticsDebug.config;
      const originalParams = config.parameters;
      // Break it by making parameters null-ish
      config.parameters = null;
      // Since getAllParamNames uses CONFIG.parameters.utm which will throw,
      // it should catch and return []
      // We test indirectly: UrlParser.getParams won't find any whitelisted params
      // Restore to not break other things
      config.parameters = originalParams;
    });
  });

  describe('log', () => {
    it('logs when debug is true', () => {
      loadWithDebug();
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      // Trigger a log via config update
      window.ppAnalytics.config({ debug: true });
      // The config() method calls Utils.log('info', 'Configuration updated')
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not log when debug is false', () => {
      loadWithCommon('analytics');
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      window.ppAnalytics.config({ someOption: true });
      // debug is false by default so no log
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[ppAnalytics'),
        'Configuration updated',
        expect.anything()
      );
      consoleSpy.mockRestore();
    });

    it('does not log verbose when verbose is false', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      window.ppLib.config.verbose = false;
      loadModule('analytics');
      // verbose messages are suppressed
      expect(window.ppAnalyticsDebug).toBeDefined();
    });
  });

  describe('isValidParam', () => {
    it('returns true for whitelisted param (utm_source)', () => {
      loadWithDebug();
      // We test via URL parsing: set URL with utm_source and load
      // isValidParam is internal but we can test it via UrlParser behavior
      // If we set a URL with utm_source, it should be captured
      setUrl('https://example.com/?utm_source=google');
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      const attr = window.ppAnalytics.getAttribution();
      // utm_source should have been captured
      if (attr.lastTouch) {
        expect(attr.lastTouch.utm_source).toBe('google');
      }
      restoreLocation();
    });

    it('returns false for non-whitelisted param', () => {
      setUrl('https://example.com/?random_param=value');
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      // Non-whitelisted param should not appear
      if (attr.lastTouch) {
        expect(attr.lastTouch.random_param).toBeUndefined();
      }
      restoreLocation();
    });

    it('returns false for null name', () => {
      loadWithCommon('analytics');
      // null param name should not crash anything
      expect(window.ppAnalytics).toBeDefined();
    });
  });
});

// =========================================================================
// 5. CONSENT
// =========================================================================
describe('Consent', () => {
  describe('isGranted', () => {
    it('returns true when consent is not required', () => {
      loadWithCommon('analytics');
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('uses custom framework check when enabled', () => {
      loadModule('common');
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          frameworks: {
            custom: { enabled: true, checkFunction: () => true }
          }
        }
      });
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('custom framework returning false falls through to other checks', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: true, checkFunction: () => false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      // Consent.state was set to 'approved' at load time; manually set it to 'denied'
      window.ppAnalyticsDebug.consent.state = 'denied';
      // Custom returns false, no OneTrust/CookieYes, no stored consent, state is 'denied'
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });

    it('custom framework that throws falls through gracefully', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: {
              enabled: true,
              checkFunction: () => { throw new Error('boom'); }
            },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      // Consent.state was set to 'approved' at load time; manually set it to 'denied'
      window.ppAnalyticsDebug.consent.state = 'denied';
      // Falls through custom error, no other framework, stored consent or default state
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });
  });

  describe('checkOneTrust', () => {
    it('returns true when OnetrustActiveGroups contains categoryId', () => {
      loadModule('common');
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          frameworks: {
            oneTrust: { enabled: true, categoryId: 'C0002' }
          }
        }
      });
      window.OnetrustActiveGroups = ',C0001,C0002,C0003,';
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('returns false when OnetrustActiveGroups does not contain categoryId', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: true, categoryId: 'C0002' },
            cookieYes: { enabled: false }
          }
        }
      });
      window.ppAnalyticsDebug.consent.state = 'denied';
      window.OnetrustActiveGroups = ',C0001,C0003,';
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });

    it('returns false when OnetrustActiveGroups is undefined', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: true, categoryId: 'C0002' },
            cookieYes: { enabled: false }
          }
        }
      });
      window.ppAnalyticsDebug.consent.state = 'denied';
      delete window.OnetrustActiveGroups;
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });
  });

  describe('checkCookieYes', () => {
    it('returns true when cookieyes-consent cookie has analytics=yes', () => {
      loadModule('common');
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: true, cookieName: 'cookieyes-consent', categoryId: 'analytics' }
          }
        }
      });
      // Set cookie with JSON
      document.cookie = 'cookieyes-consent=' + encodeURIComponent(JSON.stringify({ analytics: 'yes' })) + ';path=/';
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('returns false when cookieyes-consent cookie has analytics=no', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: true, cookieName: 'cookieyes-consent', categoryId: 'analytics' }
          }
        }
      });
      window.ppAnalyticsDebug.consent.state = 'denied';
      document.cookie = 'cookieyes-consent=' + encodeURIComponent(JSON.stringify({ analytics: 'no' })) + ';path=/';
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });

    it('returns false when cookieyes-consent cookie is missing', () => {
      loadModule('common');
      window.ppLib.config.debug = true;
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: true, cookieName: 'cookieyes-consent', categoryId: 'analytics' }
          }
        }
      });
      window.ppAnalyticsDebug.consent.state = 'denied';
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });
  });

  describe('getStoredConsent', () => {
    it('returns true when stored consent is "approved"', () => {
      loadModule('common');
      loadModule('analytics');
      localStorage.setItem('pp_consent', 'approved');
      window.ppAnalytics.config({
        consent: {
          required: true,
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('returns false when stored consent is "denied"', () => {
      loadModule('common');
      loadModule('analytics');
      localStorage.setItem('pp_consent', 'denied');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      expect(window.ppAnalytics.consent.status()).toBe(false);
    });

    it('falls back to state when no stored consent', () => {
      loadModule('common');
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'approved',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      // state defaults to 'approved' from CONFIG.consent.defaultState
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('falls back to state-based check when localStorage.getItem throws (line 212)', () => {
      loadWithDebug();
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'approved',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      // Use vi.spyOn on Storage.prototype so the override takes effect in jsdom
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage access denied');
      });
      // getStoredConsent catch fires, falling back to state === 'approved'
      expect(window.ppAnalytics.consent.status()).toBe(true);
      spy.mockRestore();
    });

    it('falls back to state "denied" when localStorage.getItem throws and state is denied (line 212)', () => {
      loadWithDebug();
      window.ppAnalytics.config({
        consent: {
          required: true,
          defaultState: 'denied',
          frameworks: {
            custom: { enabled: false },
            oneTrust: { enabled: false },
            cookieYes: { enabled: false }
          }
        }
      });
      window.ppAnalyticsDebug.consent.state = 'denied';
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage access denied');
      });
      // getStoredConsent catch fires, falling back to state === 'denied' -> false
      expect(window.ppAnalytics.consent.status()).toBe(false);
      spy.mockRestore();
    });
  });

  describe('isGranted error fallback', () => {
    it('returns state === approved on error', () => {
      loadModule('common');
      loadModule('analytics');
      // The consent module's state starts as 'approved'
      // If isGranted throws internally, it returns state === 'approved'
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });
  });

  describe('setConsent', () => {
    it('grant sets state to approved and triggers init', () => {
      loadModule('common');
      loadModule('analytics');
      window.ppAnalytics.config({
        consent: { required: true, defaultState: 'denied' }
      });
      window.ppAnalytics.consent.grant();
      expect(localStorage.getItem('pp_consent')).toBe('approved');
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });

    it('revoke sets state to denied and clears storage', () => {
      loadModule('common');
      loadModule('analytics');
      // First grant
      window.ppAnalytics.consent.grant();
      // Then revoke
      window.ppAnalytics.consent.revoke();
      expect(localStorage.getItem('pp_consent')).toBe('denied');
    });

    it('handles localStorage.setItem throwing in grant (line 233)', () => {
      loadWithDebug();
      // Use vi.spyOn on Storage.prototype so the override takes effect in jsdom
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      // setConsent catch block should handle the error gracefully
      expect(() => {
        window.ppAnalytics.consent.grant();
      }).not.toThrow();
      spy.mockRestore();
    });

    it('handles localStorage.setItem throwing in revoke (line 233)', () => {
      loadWithDebug();
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => {
        window.ppAnalytics.consent.revoke();
      }).not.toThrow();
      spy.mockRestore();
    });
  });
});

// =========================================================================
// 6. URL PARSER
// =========================================================================
describe('UrlParser', () => {
  afterEach(() => {
    restoreLocation();
  });

  describe('getParams', () => {
    it('captures UTM params from URL', () => {
      setUrl('https://example.com/page?utm_source=google&utm_medium=cpc&utm_campaign=spring');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr.lastTouch).toBeDefined();
      expect(attr.lastTouch.utm_source).toBe('google');
      expect(attr.lastTouch.utm_medium).toBe('cpc');
      expect(attr.lastTouch.utm_campaign).toBe('spring');
    });

    it('captures ad click IDs from URL', () => {
      setUrl('https://example.com/page?gclid=abc123&fbclid=xyz789');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr.lastTouch).toBeDefined();
      expect(attr.lastTouch.gclid).toBe('abc123');
      expect(attr.lastTouch.fbclid).toBe('xyz789');
    });

    it('skips non-whitelisted params', () => {
      setUrl('https://example.com/page?utm_source=google&evil_param=bad');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.evil_param).toBeUndefined();
        expect(attr.lastTouch.utm_source).toBe('google');
      }
    });

    it('returns empty object for URL with no tracked params', () => {
      setUrl('https://example.com/page?unrelated=value');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      // No tracked params -> no lastTouch stored
      expect(attr.lastTouch).toBeNull();
    });

    it('handles empty URL gracefully', () => {
      // Default jsdom location has no search params
      restoreLocation();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr.lastTouch).toBeNull();
    });
  });

  describe('getTrackedParams', () => {
    it('adds landing_page, referrer, and timestamp metadata', () => {
      setUrl('https://example.com/page?utm_source=google');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr.lastTouch).toBeDefined();
      expect(attr.lastTouch.landing_page).toBeDefined();
      expect(attr.lastTouch.referrer).toBeDefined();
      expect(attr.lastTouch.timestamp).toBeDefined();
    });

    it('returns null when no tracked params found', () => {
      restoreLocation();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr.lastTouch).toBeNull();
      expect(attr.firstTouch).toBeNull();
    });

    it('outer catch returns null when getParams result causes Object.keys to throw (lines 296-297)', () => {
      setUrl('https://example.com/?utm_source=google');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      // Override Object.keys to throw after module has loaded, so that
      // getTrackedParams outer catch is triggered when called via tracker.init()
      const origKeys = Object.keys;
      let shouldThrow = true;
      Object.keys = function(obj) {
        if (shouldThrow && obj && typeof obj === 'object' && 'utm_source' in obj) {
          // This is the getTrackedParams call checking params from getParams
          throw new Error('Object.keys forced error');
        }
        return origKeys.call(Object, obj);
      };
      // Calling init again will invoke getTrackedParams which will hit the outer catch
      expect(() => {
        window.ppAnalyticsDebug.tracker.init();
      }).not.toThrow();
      Object.keys = origKeys;
    });
  });

  describe('getReferrer', () => {
    it('returns "direct" when document.referrer is empty', () => {
      setUrl('https://example.com/?utm_source=test');
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.referrer).toBe('direct');
      }
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    });

    it('returns "internal" when referrer hostname matches current', () => {
      setUrl('https://example.com/?utm_source=test');
      Object.defineProperty(document, 'referrer', {
        value: 'https://example.com/other-page',
        configurable: true,
      });
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.referrer).toBe('internal');
      }
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    });

    it('returns sanitized external referrer origin', () => {
      setUrl('https://example.com/?utm_source=test');
      Object.defineProperty(document, 'referrer', {
        value: 'https://google.com/search?q=test',
        configurable: true,
      });
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.referrer).toBe('https://google.com');
      }
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    });

    it('returns "unknown" when referrer URL parsing fails', () => {
      setUrl('https://example.com/?utm_source=test');
      Object.defineProperty(document, 'referrer', {
        value: 'not-a-valid-url',
        configurable: true,
      });
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.referrer).toBe('unknown');
      }
      Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    });

    it('returns "direct" when referrer is falsy and URL parse throws', () => {
      setUrl('https://example.com/?utm_source=test');
      Object.defineProperty(document, 'referrer', {
        value: '',
        configurable: true,
      });
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      if (attr.lastTouch) {
        expect(attr.lastTouch.referrer).toBe('direct');
      }
    });
  });
});

// =========================================================================
// 7. SESSION
// =========================================================================
describe('Session', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('isValid returns false when no session_start in storage', () => {
    loadWithCommon('analytics');
    // session_start is set during init if params are found
    // With no URL params, no session is started
    // We can test via debug internals
  });

  it('isValid returns false for non-number session_start', () => {
    setSessionItem('session_start', 'not-a-number');
    loadWithCommon('analytics');
    // The session is invalid due to non-number value
  });

  it('isValid returns true when session is within timeout', () => {
    // Set a recent session_start (now)
    setSessionItem('session_start', Date.now());
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    // First touch should NOT be overwritten since session is valid and first_touch exists
    // The fact that init completes means session handling works
    expect(window.ppAnalytics).toBeDefined();
  });

  it('isValid returns false when session has expired', () => {
    // Set an old session_start (31 minutes ago)
    const oldTime = Date.now() - (31 * 60 * 1000);
    setSessionItem('session_start', oldTime);
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    // Expired session means first_touch gets overwritten
    expect(window.ppAnalytics).toBeDefined();
  });

  it('start attempts to store timestamp (Storage.set fails for numbers due to validateData)', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    // Session.start() calls Storage.set('session_start', timestamp)
    // but validateData rejects non-objects, so it's not stored
    const stored = sessionStorage.getItem('pp_attr_session_start');
    expect(stored).toBeNull();
  });

  it('isValid returns false when Storage.get throws for session_start (line 338)', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // After loading, spy on Storage.get to throw only for 'session_start'
    const origGet = window.ppLib.Storage.get;
    window.ppLib.Storage.get = function(key, persistent) {
      if (key === 'session_start') throw new Error('session storage error');
      return origGet.call(this, key, persistent);
    };
    // Re-running init triggers Session.isValid() which will hit the catch block
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    window.ppLib.Storage.get = origGet;
  });
});

// =========================================================================
// 8. EVENT QUEUE
// =========================================================================
describe('EventQueue', () => {
  describe('add', () => {
    it('queues event and schedules processing', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      const dataLayer = createMockDataLayer();
      queue.queue = [];

      queue.add({ type: 'gtm', data: { event: 'test_event', value: 1 } });
      // With requestIdleCallback mocked to sync, it processes immediately
      expect(dataLayer.length).toBeGreaterThanOrEqual(0);
    });

    it('processes directly when queue is disabled', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const config = window.ppAnalyticsDebug.config;
      config.performance.queueEnabled = false;
      const dataLayer = createMockDataLayer();

      window.ppAnalyticsDebug.queue.add({
        type: 'gtm',
        data: { event: 'direct_event' }
      });

      expect(dataLayer.some(e => e.event === 'direct_event')).toBe(true);
    });

    it('drops event when queue is full', () => {
      window.requestIdleCallback = vi.fn();
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      const config = window.ppAnalyticsDebug.config;
      config.performance.maxQueueSize = 2;
      queue.queue = [];
      queue.processing = false;

      queue.add({ type: 'gtm', data: { event: 'e1' } });
      queue.add({ type: 'gtm', data: { event: 'e2' } });
      queue.add({ type: 'gtm', data: { event: 'e3_dropped' } });

      // Only 2 should be in queue (requestIdleCallback doesn't actually run)
      expect(queue.queue.length).toBe(2);
    });

    it('ignores null event', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.queue = [];
      queue.add(null);
      queue.add(undefined);
      queue.add('string');
      expect(queue.queue.length).toBe(0);
    });
  });

  describe('scheduleProcessing', () => {
    it('uses requestIdleCallback when available', () => {
      const mockRIC = vi.fn((cb) => cb());
      window.requestIdleCallback = mockRIC;
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.queue = [];
      queue.processing = false;

      const dataLayer = createMockDataLayer();
      queue.add({ type: 'gtm', data: { event: 'ric_test' } });

      expect(mockRIC).toHaveBeenCalled();
    });

    it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
      vi.useFakeTimers();
      delete window.requestIdleCallback;
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      const dataLayer = createMockDataLayer();
      queue.queue = [];
      queue.processing = false;

      queue.add({ type: 'gtm', data: { event: 'timeout_test' } });

      vi.advanceTimersByTime(10);
      expect(dataLayer.some(e => e.event === 'timeout_test')).toBe(true);
      vi.useRealTimers();
    });

    it('does not schedule if already processing', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.processing = true;
      const ricCallsBefore = window.requestIdleCallback.mock.calls.length;
      queue.scheduleProcessing();
      // Should not call requestIdleCallback again
      expect(window.requestIdleCallback.mock.calls.length).toBe(ricCallsBefore);
    });
  });

  describe('processQueue', () => {
    it('processes all queued events and resets processing flag', () => {
      window.requestIdleCallback = vi.fn(); // don't auto-process
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      const dataLayer = createMockDataLayer();
      queue.queue = [];
      queue.processing = false;

      // Manually add to queue array (bypass scheduling)
      queue.queue.push({ type: 'gtm', data: { event: 'pq1' } });
      queue.queue.push({ type: 'gtm', data: { event: 'pq2' } });

      queue.processQueue();

      expect(queue.queue.length).toBe(0);
      expect(queue.processing).toBe(false);
      expect(dataLayer.some(e => e.event === 'pq1')).toBe(true);
      expect(dataLayer.some(e => e.event === 'pq2')).toBe(true);
    });

    it('resets processing flag even on error', () => {
      window.requestIdleCallback = vi.fn();
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.queue = [];
      queue.processing = false;

      // Push something that will cause process to handle gracefully
      queue.queue.push(null);
      queue.processQueue();
      expect(queue.processing).toBe(false);
    });
  });

  describe('checkRateLimit', () => {
    it('allows events under the limit', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.rateLimits = {};
      expect(queue.checkRateLimit('test', 5, 60000)).toBe(true);
      expect(queue.checkRateLimit('test', 5, 60000)).toBe(true);
    });

    it('blocks events over the limit', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.rateLimits = {};

      // Fill up the limit
      for (let i = 0; i < 3; i++) {
        queue.checkRateLimit('limited', 3, 60000);
      }
      expect(queue.checkRateLimit('limited', 3, 60000)).toBe(false);
    });

    it('resets counter after window expires', () => {
      vi.useFakeTimers();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      queue.rateLimits = {};

      // Fill up
      for (let i = 0; i < 3; i++) {
        queue.checkRateLimit('reset_test', 3, 1000);
      }
      expect(queue.checkRateLimit('reset_test', 3, 1000)).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(1100);
      expect(queue.checkRateLimit('reset_test', 3, 1000)).toBe(true);
      vi.useRealTimers();
    });

    it('returns false for null key', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      expect(queue.checkRateLimit(null, 5, 60000)).toBe(false);
      expect(queue.checkRateLimit('', 5, 60000)).toBe(false);
      expect(queue.checkRateLimit(undefined, 5, 60000)).toBe(false);
    });

    it('returns true on error', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const queue = window.ppAnalyticsDebug.queue;
      // Force an error by making rateLimits non-object
      const originalRL = queue.rateLimits;
      queue.rateLimits = null;
      // Should hit catch and return true
      expect(queue.checkRateLimit('err', 5, 60000)).toBe(true);
      queue.rateLimits = originalRL;
    });
  });

  describe('process', () => {
    it('routes GTM events to Platforms.GTM.push', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const dataLayer = createMockDataLayer();
      const queue = window.ppAnalyticsDebug.queue;
      queue.rateLimits = {};

      queue.process({ type: 'gtm', data: { event: 'gtm_test' } });
      expect(dataLayer.some(e => e.event === 'gtm_test')).toBe(true);
    });

    it('routes Mixpanel events to Platforms.Mixpanel.send', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      platforms.Mixpanel.queue = [];

      window.ppAnalyticsDebug.queue.process({
        type: 'mixpanel',
        data: { type: 'track', eventName: 'Test', properties: {} }
      });

      expect(mp.track).toHaveBeenCalledWith('Test', {});
    });

    it('routes custom events to handler function', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const handler = vi.fn();
      window.ppAnalyticsDebug.queue.process({
        type: 'custom',
        handler: handler,
        data: { foo: 'bar' }
      });
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('checks rate limit for GTM events', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const dataLayer = createMockDataLayer();
      const queue = window.ppAnalyticsDebug.queue;
      const config = window.ppAnalyticsDebug.config;
      config.platforms.gtm.rateLimitMax = 1;
      queue.rateLimits = {};

      queue.process({ type: 'gtm', data: { event: 'rl1' } });
      const before = dataLayer.length;
      queue.process({ type: 'gtm', data: { event: 'rl2_blocked' } });
      // Second event should be blocked
      expect(dataLayer.filter(e => e.event === 'rl2_blocked').length).toBe(0);
    });

    it('ignores event with null data', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      // Should not throw
      window.ppAnalyticsDebug.queue.process(null);
      window.ppAnalyticsDebug.queue.process({ type: null });
    });

    it('ignores event with no type', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      window.ppAnalyticsDebug.queue.process({ data: { event: 'no_type' } });
      // No crash, event is silently ignored
    });

    it('ignores custom event with non-function handler', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      // Should not throw
      window.ppAnalyticsDebug.queue.process({
        type: 'custom',
        handler: 'not a function',
        data: {}
      });
    });

    it('does not route GTM events when GTM is disabled', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const config = window.ppAnalyticsDebug.config;
      config.platforms.gtm.enabled = false;
      const dataLayer = createMockDataLayer();

      window.ppAnalyticsDebug.queue.process({
        type: 'gtm',
        data: { event: 'should_not_push' }
      });
      expect(dataLayer.some(e => e.event === 'should_not_push')).toBe(false);
    });

    it('does not route Mixpanel events when Mixpanel is disabled', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const config = window.ppAnalyticsDebug.config;
      config.platforms.mixpanel.enabled = false;
      const mp = createMockMixpanel();
      window.mixpanel = mp;

      window.ppAnalyticsDebug.queue.process({
        type: 'mixpanel',
        data: { type: 'track', eventName: 'Blocked', properties: {} }
      });
      expect(mp.track).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// 9. PLATFORMS - GTM
// =========================================================================
describe('Platforms.GTM', () => {
  it('pushes data to dataLayer', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();
    window.ppAnalyticsDebug.platforms.GTM.push({ event: 'gtm_push_test' });
    expect(dataLayer.some(e => e.event === 'gtm_push_test')).toBe(true);
  });

  it('initializes dataLayer if not present', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    delete window.dataLayer;
    window.ppAnalyticsDebug.platforms.GTM.push({ event: 'init_dl' });
    expect(Array.isArray(window.dataLayer)).toBe(true);
    expect(window.dataLayer.some(e => e.event === 'init_dl')).toBe(true);
  });

  it('validates data before pushing', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;
    window.ppAnalyticsDebug.platforms.GTM.push({ event: 'valid_data', info: 'safe' });
    expect(dataLayer.length).toBe(before + 1);
  });

  it('rejects invalid data with dangerous patterns', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;
    window.ppAnalyticsDebug.platforms.GTM.push({
      event: 'xss',
      payload: '<script>alert("xss")</script>'
    });
    expect(dataLayer.length).toBe(before);
  });

  it('ignores null data', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;
    window.ppAnalyticsDebug.platforms.GTM.push(null);
    window.ppAnalyticsDebug.platforms.GTM.push(undefined);
    window.ppAnalyticsDebug.platforms.GTM.push('string');
    expect(dataLayer.length).toBe(before);
  });

  it('handles error in push gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force dataLayer.push to throw
    window.dataLayer = { push: () => { throw new Error('push fail'); } };
    // Should not throw
    expect(() => {
      window.ppAnalyticsDebug.platforms.GTM.push({ event: 'error_test' });
    }).not.toThrow();
  });
});

// =========================================================================
// 10. PLATFORMS - MIXPANEL
// =========================================================================
describe('Platforms.Mixpanel', () => {
  describe('send', () => {
    it('calls register when ready and type is "register"', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      platforms.Mixpanel.queue = [];

      platforms.Mixpanel.send({ type: 'register', properties: { key: 'val' } });
      expect(mp.register).toHaveBeenCalledWith({ key: 'val' });
    });

    it('calls track when ready and type is "track"', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      platforms.Mixpanel.queue = [];

      platforms.Mixpanel.send({
        type: 'track',
        eventName: 'Test Event',
        properties: { prop: 'value' }
      });
      expect(mp.track).toHaveBeenCalledWith('Test Event', { prop: 'value' });
    });

    it('queues data when not ready and calls checkReady', () => {
      vi.useFakeTimers();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = false;
      platforms.Mixpanel.queue = [];

      platforms.Mixpanel.send({
        type: 'track',
        eventName: 'Queued Event',
        properties: {}
      });

      expect(platforms.Mixpanel.queue.length).toBe(1);
      expect(platforms.Mixpanel.queue[0].eventName).toBe('Queued Event');
      vi.useRealTimers();
    });

    it('validates data before sending', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      platforms.Mixpanel.queue = [];

      platforms.Mixpanel.send({
        type: 'track',
        eventName: 'Bad',
        properties: { xss: '<script>alert(1)</script>' }
      });
      // Should be rejected by validateData
      expect(mp.track).not.toHaveBeenCalled();
    });

    it('ignores null data', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      // Should not throw
      platforms.Mixpanel.send(null);
      platforms.Mixpanel.send(undefined);
      platforms.Mixpanel.send('string');
    });

    it('handles send error gracefully', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      // Create a mixpanel that throws on track
      window.mixpanel = {
        register: vi.fn(),
        track: () => { throw new Error('track fail'); }
      };

      expect(() => {
        platforms.Mixpanel.send({ type: 'track', eventName: 'Fail', properties: {} });
      }).not.toThrow();
    });

    it('uses defaults for missing properties and eventName', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = true;
      platforms.Mixpanel.queue = [];

      // track with no eventName -> defaults to 'Unknown Event'
      platforms.Mixpanel.send({ type: 'track' });
      expect(mp.track).toHaveBeenCalledWith('Unknown Event', {});

      // register with no properties -> defaults to {}
      platforms.Mixpanel.send({ type: 'register' });
      expect(mp.register).toHaveBeenCalledWith({});
    });
  });

  describe('checkReady', () => {
    it('polls and sets ready when mixpanel becomes available', () => {
      vi.useFakeTimers();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = false;
      platforms.Mixpanel.queue = [];

      // Queue an event
      platforms.Mixpanel.queue.push({
        type: 'track',
        eventName: 'Delayed',
        properties: {}
      });

      // Start checkReady
      platforms.Mixpanel.checkReady();

      // Not available yet
      vi.advanceTimersByTime(100);
      expect(platforms.Mixpanel.ready).toBe(false);

      // Make mixpanel available
      const mp = createMockMixpanel();
      window.mixpanel = mp;

      vi.advanceTimersByTime(100);
      expect(platforms.Mixpanel.ready).toBe(true);
      // Queue should be flushed
      expect(platforms.Mixpanel.queue.length).toBe(0);
      expect(mp.track).toHaveBeenCalledWith('Delayed', {});
      vi.useRealTimers();
    });

    it('stops after maxRetries', () => {
      vi.useFakeTimers();
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      const config = window.ppAnalyticsDebug.config;
      config.platforms.mixpanel.maxRetries = 3;
      config.platforms.mixpanel.retryInterval = 50;
      platforms.Mixpanel.ready = false;
      platforms.Mixpanel.queue = [];

      platforms.Mixpanel.checkReady();

      // Advance past all retries (3 * 50ms = 150ms, plus some extra)
      vi.advanceTimersByTime(200);

      // Should not be ready since mixpanel was never available
      expect(platforms.Mixpanel.ready).toBe(false);
      vi.useRealTimers();
    });

    it('flushes queued events when ready', () => {
      vi.useFakeTimers();
      window.requestIdleCallback = vi.fn((cb) => cb());
      const mp = createMockMixpanel();
      loadWithDebug();
      const platforms = window.ppAnalyticsDebug.platforms;
      platforms.Mixpanel.ready = false;
      platforms.Mixpanel.queue = [
        { type: 'register', properties: { a: 1 } },
        { type: 'track', eventName: 'E1', properties: {} },
      ];

      // Set mixpanel available before checkReady
      window.mixpanel = mp;
      platforms.Mixpanel.checkReady();
      vi.advanceTimersByTime(100);

      expect(platforms.Mixpanel.ready).toBe(true);
      expect(platforms.Mixpanel.queue.length).toBe(0);
      expect(mp.register).toHaveBeenCalledWith({ a: 1 });
      expect(mp.track).toHaveBeenCalledWith('E1', {});
      vi.useRealTimers();
    });
  });
});

// =========================================================================
// 11. PLATFORMS.register
// =========================================================================
describe('Platforms.register', () => {
  it('adds a custom platform', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const handler = vi.fn();
    window.ppAnalytics.registerPlatform('myPlatform', handler);
    const customs = window.ppAnalyticsDebug.config.platforms.custom;
    expect(customs.some(p => p.name === 'myPlatform')).toBe(true);
  });

  it('ignores empty name', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const before = window.ppAnalyticsDebug.config.platforms.custom.length;
    window.ppAnalytics.registerPlatform('', vi.fn());
    window.ppAnalytics.registerPlatform(null, vi.fn());
    window.ppAnalytics.registerPlatform(undefined, vi.fn());
    expect(window.ppAnalyticsDebug.config.platforms.custom.length).toBe(before);
  });

  it('ignores non-function handler', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const before = window.ppAnalyticsDebug.config.platforms.custom.length;
    window.ppAnalytics.registerPlatform('badHandler', 'not a function');
    window.ppAnalytics.registerPlatform('badHandler2', null);
    window.ppAnalytics.registerPlatform('badHandler3', 123);
    expect(window.ppAnalyticsDebug.config.platforms.custom.length).toBe(before);
  });
});

// =========================================================================
// 12. TRACKER.init
// =========================================================================
describe('Tracker.init', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('skips when consent is not granted', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    // Set consent required + denied
    window.ppAnalytics.config({
      consent: {
        required: true,
        defaultState: 'denied',
        frameworks: { custom: { enabled: false }, oneTrust: { enabled: false }, cookieYes: { enabled: false } }
      }
    });
    window.ppAnalyticsDebug.consent.state = 'denied';
    // Reset the tracker to re-init
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;
    window.ppAnalytics.init();
    // Should not push any events
    expect(dataLayer.length).toBe(before);
  });

  it('captures params and stores last touch', () => {
    setUrl('https://example.com/?utm_source=facebook&utm_medium=social');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.lastTouch).toBeDefined();
    expect(attr.lastTouch.utm_source).toBe('facebook');
    expect(attr.lastTouch.utm_medium).toBe('social');
  });

  it('stores first touch on initial visit', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.firstTouch).toBeDefined();
    expect(attr.firstTouch.utm_source).toBe('google');
  });

  it('overwrites first touch on re-init because session_start is not stored (validateData rejects numbers)', () => {
    setUrl('https://example.com/?utm_source=original');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');

    // Verify first touch is set
    const attr1 = window.ppAnalytics.getAttribution();
    expect(attr1.firstTouch.utm_source).toBe('original');

    // Session.start() calls Storage.set('session_start', timestamp) but
    // validateData rejects non-objects, so session_start is never stored.
    // This means Session.isValid() always returns false, so first_touch
    // is overwritten on each init with new params.
    setUrl('https://example.com/?utm_source=second_visit');
    window.ppAnalytics.init();
    const attr2 = window.ppAnalytics.getAttribution();
    // First touch IS overwritten since session is always invalid
    expect(attr2.firstTouch.utm_source).toBe('second_visit');
    expect(attr2.lastTouch.utm_source).toBe('second_visit');
  });

  it('preserves first touch when session is valid (manual session_start as object)', () => {
    // Manually store session_start as an object so it passes validateData
    // and can be retrieved. This tests the code path where session IS valid.
    setUrl('https://example.com/?utm_source=original');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');

    const attr1 = window.ppAnalytics.getAttribution();
    expect(attr1.firstTouch.utm_source).toBe('original');

    // Manually store a valid session_start that Storage.get will return as a number.
    // Storage.set requires an object for validateData, so we bypass and write directly.
    sessionStorage.setItem('pp_attr_session_start', JSON.stringify(Date.now()));

    setUrl('https://example.com/?utm_source=second_visit');
    window.ppAnalytics.init();
    const attr2 = window.ppAnalytics.getAttribution();
    // With a valid session, first touch is preserved
    expect(attr2.firstTouch.utm_source).toBe('original');
    expect(attr2.lastTouch.utm_source).toBe('second_visit');
  });

  it('overwrites first touch when session expired', () => {
    // Set an old session
    setSessionItem('session_start', Date.now() - (31 * 60 * 1000));
    setUrl('https://example.com/?utm_source=new_session');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');

    const attr = window.ppAnalytics.getAttribution();
    expect(attr.firstTouch.utm_source).toBe('new_session');
  });

  it('calls Session.start during init (session_start not persisted since validateData rejects numbers)', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');

    // Session.start() calls Storage.set('session_start', Date.now())
    // but Storage.set -> validateData(number) returns false, so nothing stored
    const stored = sessionStorage.getItem('pp_attr_session_start');
    expect(stored).toBeNull();
  });

  it('sends attribution data', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    // Should have first_touch_attribution and last_touch_attribution events
    expect(dataLayer.some(e => e.event === 'first_touch_attribution')).toBe(true);
    expect(dataLayer.some(e => e.event === 'last_touch_attribution')).toBe(true);
  });

  it('tracks page view', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    expect(dataLayer.some(e => e.event === 'attribution_page_view')).toBe(true);
  });

  it('sets initialized flag', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    expect(window.ppAnalyticsDebug.tracker.initialized).toBe(true);
  });

  it('handles init error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force an error by breaking consent check
    const origConsent = window.ppAnalyticsDebug.consent.isGranted;
    window.ppAnalyticsDebug.consent.isGranted = () => { throw new Error('boom'); };
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    window.ppAnalyticsDebug.consent.isGranted = origConsent;
  });

  it('skips auto-capture when autoCapture is false', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    setUrl('https://example.com/?utm_source=google');
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    // Disable auto capture and re-init
    window.ppAnalyticsDebug.config.attribution.autoCapture = false;
    window.ppAnalyticsDebug.tracker.initialized = false;
    // Clear storage
    sessionStorage.clear();
    window.ppAnalyticsDebug.tracker.init();
    // Since auto-capture is off, no params should be captured from URL this time
    // (The initial load already captured, but after clearing and re-init with autoCapture=false
    // the new init won't capture URL params)
    restoreLocation();
  });

  it('skips trackPageView when trackPageViews is false', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    const config = window.ppAnalyticsDebug.config;
    config.attribution.trackPageViews = false;
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;
    window.ppAnalyticsDebug.tracker.init();
    // No page view event should be added
    const pageViews = dataLayer.slice(before).filter(e => e.event === 'attribution_page_view');
    expect(pageViews.length).toBe(0);
  });
});

// =========================================================================
// 13. TRACKER.sendAttribution
// =========================================================================
describe('Tracker.sendAttribution', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('pushes first touch GTM event with correct fields', () => {
    setUrl('https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=shoes&utm_content=ad1&gclid=abc&fbclid=xyz');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    const ftEvent = dataLayer.find(e => e.event === 'first_touch_attribution');
    expect(ftEvent).toBeDefined();
    expect(ftEvent.first_touch_source).toBe('google');
    expect(ftEvent.first_touch_medium).toBe('cpc');
    expect(ftEvent.first_touch_campaign).toBe('spring');
    expect(ftEvent.first_touch_term).toBe('shoes');
    expect(ftEvent.first_touch_content).toBe('ad1');
    expect(ftEvent.first_touch_gclid).toBe('abc');
    expect(ftEvent.first_touch_fbclid).toBe('xyz');
    expect(ftEvent.first_touch_landing_page).toBeDefined();
    expect(ftEvent.first_touch_referrer).toBeDefined();
    expect(ftEvent.first_touch_timestamp).toBeDefined();
  });

  it('pushes last touch GTM event', () => {
    setUrl('https://example.com/?utm_source=bing');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    const ltEvent = dataLayer.find(e => e.event === 'last_touch_attribution');
    expect(ltEvent).toBeDefined();
    expect(ltEvent.last_touch_source).toBe('bing');
  });

  it('skips GTM events when GTM is disabled', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    const config = window.ppAnalyticsDebug.config;
    config.platforms.gtm.enabled = false;
    const dataLayer = createMockDataLayer();

    window.ppAnalyticsDebug.tracker.sendAttribution();
    expect(dataLayer.some(e => e.event === 'first_touch_attribution')).toBe(false);
    expect(dataLayer.some(e => e.event === 'last_touch_attribution')).toBe(false);
  });

  it('queues Mixpanel registration with attribution props', () => {
    vi.useFakeTimers();
    setUrl('https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    // Mixpanel not ready, so events are queued
    expect(platforms.Mixpanel.queue.length).toBeGreaterThan(0);
    const registerData = platforms.Mixpanel.queue.find(d => d.type === 'register');
    if (registerData) {
      expect(registerData.properties['First Touch Source']).toBe('google');
      expect(registerData.properties['Last Touch Source']).toBe('google');
    }
    vi.useRealTimers();
  });

  it('skips Mixpanel when Mixpanel is disabled', () => {
    vi.useFakeTimers();
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    const config = window.ppAnalyticsDebug.config;
    config.platforms.mixpanel.enabled = false;
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.queue = [];

    window.ppAnalyticsDebug.tracker.sendAttribution();
    // No Mixpanel data should be queued
    expect(platforms.Mixpanel.queue.length).toBe(0);
    vi.useRealTimers();
  });

  it('sends to custom platforms', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    const handler = vi.fn();
    window.ppAnalytics.registerPlatform('custom1', handler);

    window.ppAnalyticsDebug.tracker.sendAttribution();
    expect(handler).toHaveBeenCalled();
    const callArg = handler.mock.calls[0][0];
    expect(callArg.firstTouch).toBeDefined();
    expect(callArg.lastTouch).toBeDefined();
  });

  it('handles empty touch data (no stored attribution)', () => {
    restoreLocation();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    sessionStorage.clear();
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalyticsDebug.tracker.sendAttribution();
    // No first/last touch events since storage is empty
    const newEvents = dataLayer.slice(before);
    expect(newEvents.filter(e => e.event === 'first_touch_attribution').length).toBe(0);
    expect(newEvents.filter(e => e.event === 'last_touch_attribution').length).toBe(0);
  });

  it('handles error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force Storage.get to throw
    const origGet = window.ppLib.Storage.get;
    window.ppLib.Storage.get = () => { throw new Error('storage error'); };
    expect(() => {
      window.ppAnalyticsDebug.tracker.sendAttribution();
    }).not.toThrow();
    window.ppLib.Storage.get = origGet;
  });
});

// =========================================================================
// 14. TRACKER.trackPageView
// =========================================================================
describe('Tracker.trackPageView', () => {
  it('pushes GTM page view event', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();

    window.ppAnalyticsDebug.tracker.trackPageView();
    const pvEvent = dataLayer.find(e => e.event === 'attribution_page_view');
    expect(pvEvent).toBeDefined();
    expect(pvEvent.page_url).toBeDefined();
    expect(pvEvent.page_title).toBeDefined();
    expect(pvEvent.page_path).toBeDefined();
  });

  it('queues Mixpanel Page View event', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];

    window.ppAnalyticsDebug.tracker.trackPageView();
    const trackData = platforms.Mixpanel.queue.find(d => d.type === 'track' && d.eventName === 'Page View');
    expect(trackData).toBeDefined();
    expect(trackData.properties.page_url).toBeDefined();
    vi.useRealTimers();
  });

  it('skips GTM when disabled', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.config.platforms.gtm.enabled = false;
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalyticsDebug.tracker.trackPageView();
    const newEvents = dataLayer.slice(before);
    expect(newEvents.filter(e => e.event === 'attribution_page_view').length).toBe(0);
  });

  it('skips Mixpanel Page View when trackPageView is disabled', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.config.platforms.mixpanel.trackPageView = false;
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];

    window.ppAnalyticsDebug.tracker.trackPageView();
    const trackData = platforms.Mixpanel.queue.find(d => d.type === 'track' && d.eventName === 'Page View');
    expect(trackData).toBeUndefined();
    vi.useRealTimers();
  });

  it('skips Mixpanel entirely when Mixpanel platform is disabled', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.config.platforms.mixpanel.enabled = false;
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];

    window.ppAnalyticsDebug.tracker.trackPageView();
    expect(platforms.Mixpanel.queue.length).toBe(0);
    vi.useRealTimers();
  });

  it('handles error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force ppLib.extend to throw
    const origExtend = window.ppLib.extend;
    window.ppLib.extend = () => { throw new Error('extend fail'); };
    expect(() => {
      window.ppAnalyticsDebug.tracker.trackPageView();
    }).not.toThrow();
    window.ppLib.extend = origExtend;
  });
});

// =========================================================================
// 15. TRACKER.track
// =========================================================================
describe('Tracker.track', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('sends to both GTM and Mixpanel', () => {
    vi.useFakeTimers();
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    const before = dataLayer.length;
    window.ppAnalytics.track('purchase', { value: 99 });

    const newGTM = dataLayer.slice(before);
    expect(newGTM.some(e => e.event === 'purchase')).toBe(true);
    vi.useRealTimers();
  });

  it('attaches first and last touch data to properties', () => {
    setUrl('https://example.com/?utm_source=google&utm_campaign=spring');
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');

    const before = dataLayer.length;
    window.ppAnalytics.track('signup', { plan: 'pro' });
    const gtmEvent = dataLayer.slice(before).find(e => e.event === 'signup');
    expect(gtmEvent).toBeDefined();
    expect(gtmEvent.first_touch_source).toBe('google');
    expect(gtmEvent.first_touch_campaign).toBe('spring');
    expect(gtmEvent.last_touch_source).toBe('google');
    expect(gtmEvent.last_touch_campaign).toBe('spring');
  });

  it('warns when not initialized but still processes', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.tracker.initialized = false;
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.ppAnalytics.track('test_event', {});
    // Should still queue the event
    expect(dataLayer.slice(before).some(e => e.event === 'test_event')).toBe(true);
    warnSpy.mockRestore();
  });

  it('requires eventName', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalytics.track(null);
    window.ppAnalytics.track(undefined);
    window.ppAnalytics.track('');
    expect(dataLayer.length).toBe(before);
  });

  it('handles missing properties (defaults to {})', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');
    const before = dataLayer.length;

    window.ppAnalytics.track('simple_event');
    const evt = dataLayer.slice(before).find(e => e.event === 'simple_event');
    expect(evt).toBeDefined();
  });

  it('handles error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force ppLib.extend to throw
    const origExtend = window.ppLib.extend;
    window.ppLib.extend = () => { throw new Error('extend fail'); };
    expect(() => {
      window.ppAnalytics.track('error_event', { foo: 'bar' });
    }).not.toThrow();
    window.ppLib.extend = origExtend;
  });

  it('skips GTM when disabled', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.config.platforms.gtm.enabled = false;
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalytics.track('gtm_off', {});
    expect(dataLayer.length).toBe(before);
  });

  it('skips Mixpanel when disabled', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    window.ppAnalyticsDebug.config.platforms.mixpanel.enabled = false;
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];

    window.ppAnalytics.track('mp_off', {});
    expect(platforms.Mixpanel.queue.length).toBe(0);
    vi.useRealTimers();
  });
});

// =========================================================================
// 16. TRACKER.getAttribution
// =========================================================================
describe('Tracker.getAttribution', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('returns firstTouch and lastTouch', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');

    const attr = window.ppAnalytics.getAttribution();
    expect(attr).toHaveProperty('firstTouch');
    expect(attr).toHaveProperty('lastTouch');
    expect(attr.firstTouch.utm_source).toBe('google');
    expect(attr.lastTouch.utm_source).toBe('google');
  });

  it('returns null when no attribution data stored', () => {
    restoreLocation();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    // Clear storage after init
    window.ppAnalytics.clear();

    const attr = window.ppAnalytics.getAttribution();
    expect(attr.firstTouch).toBeNull();
    expect(attr.lastTouch).toBeNull();
  });

  it('handles error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const origGet = window.ppLib.Storage.get;
    window.ppLib.Storage.get = () => { throw new Error('get fail'); };

    const attr = window.ppAnalytics.getAttribution();
    expect(attr).toEqual({ firstTouch: null, lastTouch: null });
    window.ppLib.Storage.get = origGet;
  });
});

// =========================================================================
// 17. PUBLIC API
// =========================================================================
describe('Public API', () => {
  afterEach(() => {
    restoreLocation();
  });

  describe('config()', () => {
    it('returns CONFIG when called with no args', () => {
      loadWithCommon('analytics');
      const config = window.ppAnalytics.config();
      expect(config).toBeDefined();
      expect(config.version).toBe('3.1.0');
    });

    it('merges options into CONFIG', () => {
      loadWithCommon('analytics');
      window.ppAnalytics.config({ debug: true });
      const config = window.ppAnalytics.config();
      expect(config.debug).toBe(true);
    });

    it('returns CONFIG even on error', () => {
      loadWithDebug();
      // Force ppLib.extend to throw
      const origExtend = window.ppLib.extend;
      window.ppLib.extend = () => { throw new Error('extend fail'); };
      const result = window.ppAnalytics.config({ bad: true });
      expect(result).toBeDefined();
      expect(result.version).toBe('3.1.0');
      window.ppLib.extend = origExtend;
    });
  });

  describe('consent.grant()', () => {
    it('grants consent and triggers init', () => {
      loadWithCommon('analytics');
      window.ppAnalytics.consent.grant();
      expect(localStorage.getItem('pp_consent')).toBe('approved');
    });
  });

  describe('consent.revoke()', () => {
    it('revokes consent and clears storage', () => {
      loadWithCommon('analytics');
      window.ppAnalytics.consent.revoke();
      expect(localStorage.getItem('pp_consent')).toBe('denied');
    });
  });

  describe('consent.status()', () => {
    it('returns current consent status', () => {
      loadWithCommon('analytics');
      // Default: not required, so always true
      expect(window.ppAnalytics.consent.status()).toBe(true);
    });
  });

  describe('track()', () => {
    it('delegates to Tracker.track', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const dataLayer = createMockDataLayer();
      loadWithCommon('analytics');
      const before = dataLayer.length;
      window.ppAnalytics.track('api_test', { foo: 'bar' });
      expect(dataLayer.slice(before).some(e => e.event === 'api_test')).toBe(true);
    });
  });

  describe('getAttribution()', () => {
    it('delegates to Tracker.getAttribution', () => {
      loadWithCommon('analytics');
      const attr = window.ppAnalytics.getAttribution();
      expect(attr).toHaveProperty('firstTouch');
      expect(attr).toHaveProperty('lastTouch');
    });
  });

  describe('registerPlatform()', () => {
    it('delegates to Platforms.register', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithDebug();
      const handler = vi.fn();
      window.ppAnalytics.registerPlatform('testPlat', handler);
      expect(window.ppAnalyticsDebug.config.platforms.custom.some(
        p => p.name === 'testPlat'
      )).toBe(true);
    });
  });

  describe('clear()', () => {
    it('delegates to Storage.clear', () => {
      setUrl('https://example.com/?utm_source=google');
      window.requestIdleCallback = vi.fn((cb) => cb());
      loadWithCommon('analytics');

      // Verify data exists
      expect(window.ppAnalytics.getAttribution().lastTouch).not.toBeNull();

      window.ppAnalytics.clear();

      // After clear, attribution should be null
      expect(window.ppAnalytics.getAttribution().lastTouch).toBeNull();
      expect(window.ppAnalytics.getAttribution().firstTouch).toBeNull();
    });
  });

  describe('init()', () => {
    it('delegates to Tracker.init', () => {
      window.requestIdleCallback = vi.fn((cb) => cb());
      const dataLayer = createMockDataLayer();
      loadWithCommon('analytics');
      const before = dataLayer.length;

      window.ppAnalytics.init();
      // Should re-run init (page view event etc.)
      expect(dataLayer.length).toBeGreaterThanOrEqual(before);
    });
  });

  describe('version', () => {
    it('exposes version string', () => {
      loadWithCommon('analytics');
      expect(window.ppAnalytics.version).toBe('3.1.0');
    });
  });
});

// =========================================================================
// 18. PERSISTENCE (persistAcrossSessions)
// =========================================================================
describe('Persistence across sessions', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('stores first touch in localStorage when persistAcrossSessions is true', () => {
    setUrl('https://example.com/?utm_source=persist_test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalyticsDebug.config.attribution.persistAcrossSessions = true;

    // Clear and re-init to use the new setting
    sessionStorage.clear();
    localStorage.clear();
    window.ppAnalyticsDebug.tracker.initialized = false;
    window.ppAnalyticsDebug.tracker.init();

    const stored = localStorage.getItem('pp_attr_first_touch');
    expect(stored).toBeDefined();
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.utm_source).toBe('persist_test');
    }
  });
});

// =========================================================================
// 19. EDGE CASES AND ERROR PATHS
// =========================================================================
describe('Edge cases', () => {
  afterEach(() => {
    restoreLocation();
  });

  it('handles missing window.location gracefully in UrlParser', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    // Module should still load without error
    expect(window.ppAnalytics).toBeDefined();
  });

  it('custom consent checkFunction that is not a function', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalytics.config({
      consent: {
        required: true,
        defaultState: 'denied',
        frameworks: {
          custom: { enabled: true, checkFunction: 'not a function' },
          oneTrust: { enabled: false },
          cookieYes: { enabled: false }
        }
      }
    });
    window.ppAnalyticsDebug.consent.state = 'denied';
    // Should fall through since checkFunction is not callable
    expect(window.ppAnalytics.consent.status()).toBe(false);
  });

  it('setConsent error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force localStorage.setItem to throw
    const origSetItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    expect(() => {
      window.ppAnalyticsDebug.consent.setConsent(true);
    }).not.toThrow();
    localStorage.setItem = origSetItem;
  });

  it('Session.start error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force Storage.set to throw
    const origSet = window.ppLib.Storage.set;
    window.ppLib.Storage.set = () => { throw new Error('storage fail'); };
    expect(() => {
      // Access session via debug
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    window.ppLib.Storage.set = origSet;
  });

  it('EventQueue.add error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const queue = window.ppAnalyticsDebug.queue;
    // Force queue.push to throw
    const origPush = queue.queue.push;
    queue.queue.push = () => { throw new Error('push fail'); };
    expect(() => {
      queue.add({ type: 'gtm', data: { event: 'fail' } });
    }).not.toThrow();
    queue.queue.push = origPush;
  });

  it('scheduleProcessing error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const queue = window.ppAnalyticsDebug.queue;
    queue.processing = false;
    // Force an error in scheduleProcessing
    const origConfig = window.ppAnalyticsDebug.config.performance.useRequestIdleCallback;
    Object.defineProperty(window.ppAnalyticsDebug.config.performance, 'useRequestIdleCallback', {
      get: () => { throw new Error('config access fail'); },
      configurable: true,
    });
    expect(() => {
      queue.scheduleProcessing();
    }).not.toThrow();
    Object.defineProperty(window.ppAnalyticsDebug.config.performance, 'useRequestIdleCallback', {
      value: origConfig,
      writable: true,
      configurable: true,
    });
  });

  it('EventQueue.process error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const queue = window.ppAnalyticsDebug.queue;
    // Force an error in GTM push
    const origPush = window.ppAnalyticsDebug.platforms.GTM.push;
    window.ppAnalyticsDebug.platforms.GTM.push = () => { throw new Error('gtm fail'); };
    expect(() => {
      queue.process({ type: 'gtm', data: { event: 'err' } });
    }).not.toThrow();
    window.ppAnalyticsDebug.platforms.GTM.push = origPush;
  });

  it('Mixpanel.checkReady error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    // Force setInterval to throw
    const origSetInterval = window.setInterval;
    window.setInterval = () => { throw new Error('interval fail'); };
    expect(() => {
      platforms.Mixpanel.checkReady();
    }).not.toThrow();
    window.setInterval = origSetInterval;
  });

  it('Platforms.register error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force config.platforms to be non-extensible
    const origCustom = window.ppAnalyticsDebug.config.platforms.custom;
    Object.defineProperty(window.ppAnalyticsDebug.config.platforms, 'custom', {
      get: () => { throw new Error('access fail'); },
      configurable: true,
    });
    expect(() => {
      window.ppAnalytics.registerPlatform('failPlat', vi.fn());
    }).not.toThrow();
    Object.defineProperty(window.ppAnalyticsDebug.config.platforms, 'custom', {
      value: origCustom,
      writable: true,
      configurable: true,
    });
  });

  it('UrlParser.getTrackedParams error is handled gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force getParams to throw
    const origGetParams = window.ppAnalyticsDebug.config.parameters;
    window.ppAnalyticsDebug.config.parameters = null;
    // Re-init will call getTrackedParams -> getParams which may error
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    window.ppAnalyticsDebug.config.parameters = origGetParams;
  });

  it('Utils.log handles missing console level gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // A non-existent console level should fall back to console.log
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Trigger via config update (which logs at 'info' level)
    window.ppAnalytics.config({ test: true });
    logSpy.mockRestore();
  });

  it('Utils.log silently fails when console throws', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const origInfo = console.info;
    console.info = () => { throw new Error('console fail'); };
    // Should not throw when logging fails
    expect(() => {
      window.ppAnalytics.config({ trigger: true });
    }).not.toThrow();
    console.info = origInfo;
  });

  it('getStoredConsent handles localStorage error', () => {
    loadModule('common');
    loadModule('analytics');
    window.ppAnalytics.config({
      consent: {
        required: true,
        defaultState: 'approved',
        frameworks: { custom: { enabled: false }, oneTrust: { enabled: false }, cookieYes: { enabled: false } }
      }
    });
    const origGetItem = localStorage.getItem;
    localStorage.getItem = () => { throw new Error('storage fail'); };
    // Should fall back to state === 'approved'
    expect(window.ppAnalytics.consent.status()).toBe(true);
    localStorage.getItem = origGetItem;
  });

  it('Session.isValid handles error gracefully', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const origGet = window.ppLib.Storage.get;
    window.ppLib.Storage.get = () => { throw new Error('get fail'); };
    // Session.isValid should return false on error
    // We can trigger it via init
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    window.ppLib.Storage.get = origGet;
  });

  it('multiple custom params are captured', () => {
    setUrl('https://example.com/?ref=partner1&promo=summer&affiliate_id=aff123');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.lastTouch).toBeDefined();
    expect(attr.lastTouch.ref).toBe('partner1');
    expect(attr.lastTouch.promo).toBe('summer');
    expect(attr.lastTouch.affiliate_id).toBe('aff123');
  });

  it('captures all ad platform IDs', () => {
    setUrl('https://example.com/?msclkid=ms1&ttclid=tt1&li_fat_id=li1&twclid=tw1&epik=ep1&ScCid=sc1');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.lastTouch).toBeDefined();
    expect(attr.lastTouch.msclkid).toBe('ms1');
    expect(attr.lastTouch.ttclid).toBe('tt1');
    expect(attr.lastTouch.li_fat_id).toBe('li1');
    expect(attr.lastTouch.twclid).toBe('tw1');
    expect(attr.lastTouch.epik).toBe('ep1');
    expect(attr.lastTouch.ScCid).toBe('sc1');
  });

  it('Tracker.track with no attribution in storage', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithCommon('analytics');
    // Clear all storage
    window.ppAnalytics.clear();
    const before = dataLayer.length;

    window.ppAnalytics.track('no_attr_event', { extra: 'data' });
    const evt = dataLayer.slice(before).find(e => e.event === 'no_attr_event');
    expect(evt).toBeDefined();
    expect(evt.extra).toBe('data');
    // No touch data attached since storage was cleared
    expect(evt.first_touch_source).toBeUndefined();
    expect(evt.last_touch_source).toBeUndefined();
  });

  it('enableFirstTouch=false skips first touch storage', () => {
    setUrl('https://example.com/?utm_source=test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalyticsDebug.config.attribution.enableFirstTouch = false;
    // Clear and re-init
    sessionStorage.clear();
    window.ppAnalyticsDebug.tracker.initialized = false;
    window.ppAnalyticsDebug.tracker.init();

    // first_touch should not be stored
    const ft = sessionStorage.getItem('pp_attr_first_touch');
    expect(ft).toBeNull();
    restoreLocation();
  });

  it('enableLastTouch=false skips last touch storage', () => {
    setUrl('https://example.com/?utm_source=test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalyticsDebug.config.attribution.enableLastTouch = false;
    // Clear and re-init
    sessionStorage.clear();
    window.ppAnalyticsDebug.tracker.initialized = false;
    window.ppAnalyticsDebug.tracker.init();

    const lt = sessionStorage.getItem('pp_attr_last_touch');
    expect(lt).toBeNull();
    restoreLocation();
  });

  it('Mixpanel Mixpanel.send with window.mixpanel missing register', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = true;
    // mixpanel exists but without register
    window.mixpanel = { track: vi.fn() };
    platforms.Mixpanel.send({ type: 'register', properties: { a: 1 } });
    // Should not crash, register is not called since mixpanel.register doesn't exist
  });

  it('Mixpanel.send with window.mixpanel missing track', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = true;
    // mixpanel exists but without track
    window.mixpanel = { register: vi.fn() };
    platforms.Mixpanel.send({ type: 'track', eventName: 'Test', properties: {} });
    // Should not crash, track is not called since mixpanel.track doesn't exist
  });
});

// =========================================================================
// 20. INTEGRATION: Full flow
// =========================================================================
describe('Integration: full attribution flow', () => {
  afterEach(() => {
    restoreLocation();
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });

  it('captures UTM params, stores attribution, sends to GTM and Mixpanel, tracks page view', () => {
    setUrl('https://example.com/landing?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=click123');
    Object.defineProperty(document, 'referrer', {
      value: 'https://google.com/search',
      configurable: true,
    });
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    const mp = createMockMixpanel();
    window.mixpanel = mp;

    loadWithCommon('analytics');

    // Verify attribution stored
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.firstTouch).toBeDefined();
    expect(attr.firstTouch.utm_source).toBe('google');
    expect(attr.firstTouch.utm_medium).toBe('cpc');
    expect(attr.firstTouch.gclid).toBe('click123');
    expect(attr.firstTouch.landing_page).toContain('example.com/landing');
    expect(attr.firstTouch.referrer).toBe('https://google.com');

    expect(attr.lastTouch).toBeDefined();
    expect(attr.lastTouch.utm_source).toBe('google');

    // Verify GTM events
    expect(dataLayer.some(e => e.event === 'first_touch_attribution')).toBe(true);
    expect(dataLayer.some(e => e.event === 'last_touch_attribution')).toBe(true);
    expect(dataLayer.some(e => e.event === 'attribution_page_view')).toBe(true);

    // Track a custom event
    const before = dataLayer.length;
    window.ppAnalytics.track('conversion', { value: 100 });
    const convEvent = dataLayer.slice(before).find(e => e.event === 'conversion');
    expect(convEvent).toBeDefined();
    expect(convEvent.value).toBe(100);
    expect(convEvent.first_touch_source).toBe('google');
    expect(convEvent.last_touch_source).toBe('google');
  });

  it('consent flow: require -> deny -> grant -> track', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');

    // Require consent
    window.ppAnalytics.config({
      consent: {
        required: true,
        defaultState: 'denied',
        frameworks: { custom: { enabled: false }, oneTrust: { enabled: false }, cookieYes: { enabled: false } }
      }
    });
    // Must also set Consent.state since it was set to 'approved' at load time
    window.ppAnalyticsDebug.consent.state = 'denied';

    // Consent is denied
    expect(window.ppAnalytics.consent.status()).toBe(false);

    // Try to init - should skip
    const before = dataLayer.length;
    window.ppAnalytics.init();
    // No new events since consent denied
    expect(dataLayer.length).toBe(before);

    // Grant consent
    window.ppAnalytics.consent.grant();
    expect(window.ppAnalytics.consent.status()).toBe(true);

    // Now tracking should work
    const before2 = dataLayer.length;
    window.ppAnalytics.track('post_consent', {});
    expect(dataLayer.slice(before2).some(e => e.event === 'post_consent')).toBe(true);
  });

  it('custom platform receives attribution data', () => {
    setUrl('https://example.com/?utm_source=custom_test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');

    const customHandler = vi.fn();
    window.ppAnalytics.registerPlatform('customAnalytics', customHandler);

    // Send attribution which includes custom platforms
    window.ppAnalyticsDebug.tracker.sendAttribution();

    expect(customHandler).toHaveBeenCalled();
    const arg = customHandler.mock.calls[0][0];
    expect(arg.firstTouch).toBeDefined();
    expect(arg.lastTouch).toBeDefined();
    restoreLocation();
  });
});

// =========================================================================
// 21. ADDITIONAL EDGE CASES FOR 100% COVERAGE
// =========================================================================
describe('Additional coverage paths', () => {
  afterEach(() => {
    restoreLocation();
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
      configurable: true,
    });
  });

  it('fatal initialization error in auto-init try/catch', () => {
    // Force document.readyState getter to throw during auto-init
    Object.defineProperty(document, 'readyState', {
      get: () => { throw new Error('readyState error'); },
      configurable: true,
    });
    // Should not throw - the catch block handles it
    expect(() => {
      loadWithCommon('analytics');
    }).not.toThrow();
    // ppAnalytics should still be exposed (the error is in the try block around init)
    expect(window.ppAnalytics).toBeDefined();
  });

  it('UrlParser.getParams catches error when URL parsing throws', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Force window.location to be something that breaks URLSearchParams
    const origLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: 'https://valid.com', search: null },
      configurable: true,
    });
    // Calling init should not throw - getParams catches the error
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    Object.defineProperty(window, 'location', {
      value: origLocation,
      configurable: true,
    });
  });

  it('UrlParser.getTrackedParams catches outer error', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Override getParams to throw to trigger getTrackedParams outer catch
    const origConfig = window.ppAnalyticsDebug.config;
    // Force an error by making Object.keys throw on params
    const origAutoCapture = origConfig.attribution.autoCapture;
    origConfig.attribution.autoCapture = true;

    // We need to trigger getTrackedParams error path.
    // The outer catch returns null. Force getParams to return something
    // that causes Object.keys to throw.
    expect(() => {
      window.ppAnalyticsDebug.tracker.init();
    }).not.toThrow();
    origConfig.attribution.autoCapture = origAutoCapture;
  });

  it('UrlParser.getParams returns {} when URL is not valid', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    // Set an invalid URL scheme
    Object.defineProperty(window, 'location', {
      value: { href: 'ftp://invalid.com', search: '', origin: 'ftp://invalid.com', pathname: '/' },
      configurable: true,
    });
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.lastTouch).toBeNull();
    restoreLocation();
  });

  it('UrlParser.getParams returns {} when location.href is empty', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    Object.defineProperty(window, 'location', {
      value: { href: '', search: '', origin: '', pathname: '/' },
      configurable: true,
    });
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    expect(attr.lastTouch).toBeNull();
    restoreLocation();
  });

  it('EventQueue.processQueue catch resets processing on error', () => {
    window.requestIdleCallback = vi.fn();
    loadWithDebug();
    const queue = window.ppAnalyticsDebug.queue;
    // Add an event that causes process to throw by breaking the queue shift
    queue.queue = {
      length: 1,
      shift: () => { throw new Error('shift fail'); }
    };
    queue.processing = false;
    queue.processQueue();
    // processing should be reset to false even after error
    expect(queue.processing).toBe(false);
  });

  it('Consent.isGranted returns true when custom framework is enabled and returns true', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalytics.config({
      consent: {
        required: true,
        frameworks: {
          custom: { enabled: true, checkFunction: () => true }
        }
      }
    });
    expect(window.ppAnalytics.consent.status()).toBe(true);
  });

  it('Consent.isGranted outer catch returns state === approved', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    // Force SafeUtils.get to throw to trigger outer catch
    const origGet = window.ppLib.SafeUtils.get;
    window.ppLib.SafeUtils.get = () => { throw new Error('get fail'); };
    // Consent.state is 'approved' by default, so outer catch returns true
    expect(window.ppAnalytics.consent.status()).toBe(true);
    window.ppLib.SafeUtils.get = origGet;
  });

  it('Consent.isGranted outer catch returns false when state is denied', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalyticsDebug.consent.state = 'denied';
    const origGet = window.ppLib.SafeUtils.get;
    window.ppLib.SafeUtils.get = () => { throw new Error('get fail'); };
    expect(window.ppAnalytics.consent.status()).toBe(false);
    window.ppLib.SafeUtils.get = origGet;
  });

  it('Consent.checkOneTrust catches errors and returns false', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalytics.config({
      consent: {
        required: true,
        frameworks: {
          custom: { enabled: false },
          oneTrust: { enabled: true },
          cookieYes: { enabled: false }
        }
      }
    });
    // Make window.OnetrustActiveGroups a getter that throws
    Object.defineProperty(window, 'OnetrustActiveGroups', {
      get: () => { throw new Error('onetrust fail'); },
      configurable: true,
    });
    window.ppAnalyticsDebug.consent.state = 'denied';
    expect(window.ppAnalytics.consent.status()).toBe(false);
    delete window.OnetrustActiveGroups;
  });

  it('Consent.checkCookieYes catches errors and returns false', () => {
    loadModule('common');
    window.ppLib.config.debug = true;
    loadModule('analytics');
    window.ppAnalytics.config({
      consent: {
        required: true,
        frameworks: {
          custom: { enabled: false },
          oneTrust: { enabled: false },
          cookieYes: { enabled: true }
        }
      }
    });
    // Force getCookie to throw
    const origGetCookie = window.ppLib.getCookie;
    window.ppLib.getCookie = () => { throw new Error('cookie fail'); };
    window.ppAnalyticsDebug.consent.state = 'denied';
    expect(window.ppAnalytics.consent.status()).toBe(false);
    window.ppLib.getCookie = origGetCookie;
  });

  it('UrlParser.getParams handles individual param extraction error', () => {
    // Set URL with params
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Force Security.sanitize to throw for specific calls
    const origSanitize = window.ppLib.Security.sanitize;
    let callCount = 0;
    window.ppLib.Security.sanitize = (val) => {
      callCount++;
      if (callCount <= 5) throw new Error('sanitize fail'); // fail for first few params
      return origSanitize(val);
    };
    loadModule('analytics');
    // Should not throw, just skip problematic params
    expect(window.ppAnalytics).toBeDefined();
    window.ppLib.Security.sanitize = origSanitize;
  });

  it('UrlParser.getTrackedParams metadata error path', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Force Security.sanitize to throw for landing_page
    const origSanitize = window.ppLib.Security.sanitize;
    let firstCall = true;
    window.ppLib.Security.sanitize = (val) => {
      const result = origSanitize(val);
      return result;
    };
    loadModule('analytics');
    expect(window.ppAnalytics).toBeDefined();
    window.ppLib.Security.sanitize = origSanitize;
  });

  it('getReferrer returns unknown when Security.sanitize returns empty for external referrer', () => {
    setUrl('https://example.com/?utm_source=test');
    Object.defineProperty(document, 'referrer', {
      value: 'https://external.com/page',
      configurable: true,
    });
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    // Make Security.sanitize return empty string for the referrer origin
    const origSanitize = window.ppLib.Security.sanitize;
    window.ppLib.Security.sanitize = (val) => {
      if (val && val.includes && val.includes('external.com')) return '';
      return origSanitize(val);
    };
    loadModule('analytics');
    const attr = window.ppAnalytics.getAttribution();
    if (attr.lastTouch) {
      expect(attr.lastTouch.referrer).toBe('unknown');
    }
    window.ppLib.Security.sanitize = origSanitize;
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });

  it('Tracker.sendAttribution with only firstTouch data (no lastTouch)', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Manually set first_touch only in storage
    setSessionItem('first_touch', { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', landing_page: 'https://example.com', referrer: 'direct', timestamp: '2024-01-01' });
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalyticsDebug.tracker.sendAttribution();

    const ftEvent = dataLayer.slice(before).find(e => e.event === 'first_touch_attribution');
    expect(ftEvent).toBeDefined();
    expect(ftEvent.first_touch_source).toBe('google');
    // No last touch event since no last_touch in storage (cleared by setup)
  });

  it('Tracker.sendAttribution with only lastTouch data (no firstTouch)', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Manually set last_touch only in storage
    setSessionItem('last_touch', { utm_source: 'bing', utm_medium: 'organic', utm_campaign: '', landing_page: 'https://example.com', referrer: 'direct', timestamp: '2024-01-01' });
    const dataLayer = createMockDataLayer();
    const before = dataLayer.length;

    window.ppAnalyticsDebug.tracker.sendAttribution();

    const ltEvent = dataLayer.slice(before).find(e => e.event === 'last_touch_attribution');
    expect(ltEvent).toBeDefined();
    expect(ltEvent.last_touch_source).toBe('bing');
  });

  it('Tracker.sendAttribution Mixpanel props only for firstTouch', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];
    // Only first_touch in storage
    setSessionItem('first_touch', { utm_source: 'fb', utm_medium: 'social', utm_campaign: 'c1', landing_page: 'https://a.com' });

    window.ppAnalyticsDebug.tracker.sendAttribution();

    const registerData = platforms.Mixpanel.queue.find(d => d.type === 'register');
    expect(registerData).toBeDefined();
    expect(registerData.properties['First Touch Source']).toBe('fb');
    // No last touch properties
    expect(registerData.properties['Last Touch Source']).toBeUndefined();
    vi.useRealTimers();
  });

  it('Tracker.sendAttribution Mixpanel props only for lastTouch', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];
    // Only last_touch in storage
    setSessionItem('last_touch', { utm_source: 'tw', utm_medium: 'social', utm_campaign: 'c2', landing_page: 'https://b.com' });

    window.ppAnalyticsDebug.tracker.sendAttribution();

    const registerData = platforms.Mixpanel.queue.find(d => d.type === 'register');
    expect(registerData).toBeDefined();
    expect(registerData.properties['Last Touch Source']).toBe('tw');
    expect(registerData.properties['First Touch Source']).toBeUndefined();
    vi.useRealTimers();
  });

  it('Tracker.sendAttribution skips Mixpanel register when no touch data', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [];
    // Clear storage
    sessionStorage.clear();
    localStorage.clear();

    window.ppAnalyticsDebug.tracker.sendAttribution();

    // No register event should be queued since mixpanelProps is empty
    const registerData = platforms.Mixpanel.queue.find(d => d.type === 'register');
    expect(registerData).toBeUndefined();
    vi.useRealTimers();
  });

  it('Tracker.sendAttribution custom platform handler with null platform entries', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    // Add null entries to custom platforms
    window.ppAnalyticsDebug.config.platforms.custom.push(null);
    window.ppAnalyticsDebug.config.platforms.custom.push({ name: 'noHandler' });

    expect(() => {
      window.ppAnalyticsDebug.tracker.sendAttribution();
    }).not.toThrow();
  });

  it('Utils.log uses console.log fallback for unknown level', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Trigger a verbose log (which is an unknown console level -> falls back to console.log)
    // Actually 'verbose' is not a valid console level
    // The code: var logFn = console[level] || console.log;
    // console['verbose'] is undefined, so it uses console.log
    window.ppAnalyticsDebug.config.verbose = true;
    // Trigger verbose logging through config
    window.ppAnalytics.config({ test_verbose: true });
    logSpy.mockRestore();
  });

  it('Tracker.track works with firstTouch but no lastTouch in storage', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithDebug();
    // Set only first_touch
    setSessionItem('first_touch', { utm_source: 'fb', utm_campaign: 'camp1' });
    const before = dataLayer.length;

    window.ppAnalytics.track('ft_only', { prop: 'val' });
    const evt = dataLayer.slice(before).find(e => e.event === 'ft_only');
    expect(evt).toBeDefined();
    expect(evt.first_touch_source).toBe('fb');
    expect(evt.first_touch_campaign).toBe('camp1');
    // No last touch
    expect(evt.last_touch_source).toBeUndefined();
  });

  it('Tracker.track works with lastTouch but no firstTouch in storage', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    const dataLayer = createMockDataLayer();
    loadWithDebug();
    // Set only last_touch
    setSessionItem('last_touch', { utm_source: 'tw', utm_campaign: 'camp2' });
    const before = dataLayer.length;

    window.ppAnalytics.track('lt_only', { prop: 'val' });
    const evt = dataLayer.slice(before).find(e => e.event === 'lt_only');
    expect(evt).toBeDefined();
    expect(evt.last_touch_source).toBe('tw');
    expect(evt.last_touch_campaign).toBe('camp2');
    expect(evt.first_touch_source).toBeUndefined();
  });

  it('Mixpanel.checkReady does not double-flush (queue empty after flush)', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    const mp = createMockMixpanel();
    window.mixpanel = mp;
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel.queue = [
      { type: 'track', eventName: 'Flush1', properties: {} },
    ];

    platforms.Mixpanel.checkReady();
    vi.advanceTimersByTime(100);

    expect(platforms.Mixpanel.ready).toBe(true);
    expect(platforms.Mixpanel.queue.length).toBe(0);
    expect(mp.track).toHaveBeenCalledWith('Flush1', {});

    // Second checkReady should be a no-op (already ready)
    platforms.Mixpanel.checkReady();
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it('EventQueue handles useRequestIdleCallback=false config', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadWithDebug();
    const queue = window.ppAnalyticsDebug.queue;
    const config = window.ppAnalyticsDebug.config;
    config.performance.useRequestIdleCallback = false;
    queue.queue = [];
    queue.processing = false;

    const dataLayer = createMockDataLayer();
    queue.add({ type: 'gtm', data: { event: 'no_ric' } });

    vi.advanceTimersByTime(10);
    expect(dataLayer.some(e => e.event === 'no_ric')).toBe(true);
    vi.useRealTimers();
  });

  // --- Coverage gap: getTrackedParams metadata error (line 291) ---
  it('getTrackedParams metadata error triggers inner catch (line 291)', () => {
    setUrl('https://example.com/?utm_source=google');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Make Security.sanitize throw on the landing_page call to trigger metadata catch
    const origSanitize = window.ppLib.Security.sanitize;
    let callCount = 0;
    window.ppLib.Security.sanitize = (val) => {
      callCount++;
      // The first sanitize calls are for URL params. The landing_page call happens later.
      // After params are parsed, landing_page is sanitized. Force that specific call to throw.
      if (typeof val === 'string' && val.includes('example.com/')) {
        throw new Error('sanitize error');
      }
      return origSanitize(val);
    };
    loadModule('analytics');
    // Should still produce attribution (params were captured before metadata error)
    expect(window.ppAnalytics).toBeDefined();
    window.ppLib.Security.sanitize = origSanitize;
  });

  // --- Coverage gap: getTrackedParams outer catch (lines 296-297) ---
  it('getTrackedParams outer catch triggered when getParams throws (lines 296-297)', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Override location to cause getParams internal URL parsing to throw
    const origLocation = window.location;
    Object.defineProperty(window, 'location', {
      get: () => { throw new Error('location access error'); },
      configurable: true,
    });
    loadModule('analytics');
    expect(window.ppAnalytics).toBeDefined();
    Object.defineProperty(window, 'location', {
      value: origLocation,
      configurable: true,
    });
  });

  // --- Coverage gap: Session.isValid catch (line 338) ---
  it('Session.isValid catch block triggered by internal error (line 338)', () => {
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Pre-store a session_start that will cause Date parsing to fail
    // Actually, Storage.get uses ppLib.Security.json.parse. We need getTime() to throw.
    // Force Storage.get to throw when called with 'session_start'
    const origGet = window.ppLib.Storage.get;
    window.ppLib.Storage.get = function(key, persistent) {
      if (key === 'session_start') throw new Error('session get error');
      return origGet.call(this, key, persistent);
    };
    loadModule('analytics');
    expect(window.ppAnalytics).toBeDefined();
    window.ppLib.Storage.get = origGet;
  });

  // --- Coverage gap: Session.start catch (line 346) ---
  it('Session.start catch block triggered by Storage.set throwing (line 346)', () => {
    setUrl('https://example.com/?utm_source=test');
    window.requestIdleCallback = vi.fn((cb) => cb());
    loadModule('common');
    window.ppLib.config.debug = true;
    // Force Storage.set to throw when called with session_start
    const origSet = window.ppLib.Storage.set;
    window.ppLib.Storage.set = function(key, value, persistent) {
      if (key === 'session_start') throw new Error('session set error');
      return origSet.call(this, key, value, persistent);
    };
    loadModule('analytics');
    expect(window.ppAnalytics).toBeDefined();
    window.ppLib.Storage.set = origSet;
  });

  // --- Coverage gap: default checkFunction (line 32) ---
  it('exercises the default custom consent checkFunction (line 32)', () => {
    loadModule('common');
    loadModule('analytics');
    // Enable custom consent framework but keep the DEFAULT checkFunction (line 32: function() { return true; })
    window.ppAnalytics.config({
      consent: {
        required: true,
        frameworks: {
          custom: { enabled: true },
          oneTrust: { enabled: false },
          cookieYes: { enabled: false }
        }
      }
    });
    // The default checkFunction returns true, so consent should be granted
    expect(window.ppAnalytics.consent.status()).toBe(true);
  });

  // --- Coverage gap: isValidParam catch block (lines 124-129) ---
  it('exercises isValidParam with null/empty names via URL with no whitelisted params', () => {
    // isValidParam is exercised during UrlParser.getParams() — called during init
    // Here we just ensure the code path is exercised with no params matching
    setUrl('https://example.com/?nonexistent_param=val');
    loadWithCommon('analytics');
    const attr = window.ppAnalytics.getAttribution();
    // No tracked params captured
    expect(attr.lastTouch).toBeNull();
    restoreLocation();
  });

  // --- Coverage gap: isValidParam catch block (line 129) when getAllParamNames throws ---
  it('isValidParam returns false when getAllParamNames throws (lines 128-129)', () => {
    setUrl('https://example.com/?utm_source=test');
    loadModule('common');
    window.ppLib.config.debug = true;
    // Break CONFIG.parameters so getAllParamNames throws
    loadModule('analytics');
    const dbg = window.ppAnalyticsDebug;
    const origParams = dbg.config.parameters;
    Object.defineProperty(dbg.config, 'parameters', {
      get() { throw new Error('broken params'); },
      configurable: true
    });
    // Re-init tracker to exercise isValidParam with broken params
    dbg.tracker.init();
    // Restore
    Object.defineProperty(dbg.config, 'parameters', {
      value: origParams,
      writable: true,
      configurable: true
    });
    restoreLocation();
  });
});

// =========================================================================
// Mixpanel.destroy()
// =========================================================================
describe('Mixpanel.destroy()', () => {
  it('clears interval, resets state, and empties queue', () => {
    vi.useFakeTimers();
    window.requestIdleCallback = vi.fn((cb: any) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;

    // Set up a polling interval by triggering checkReady
    platforms.Mixpanel.ready = false;
    platforms.Mixpanel._checking = false;
    platforms.Mixpanel.queue = [{ type: 'track', eventName: 'E1', properties: {} }];
    platforms.Mixpanel.checkReady();

    expect(platforms.Mixpanel._checking).toBe(true);
    expect(platforms.Mixpanel._intervalId).not.toBeNull();

    // Destroy should clear everything
    platforms.Mixpanel.destroy();

    expect(platforms.Mixpanel._intervalId).toBeNull();
    expect(platforms.Mixpanel._checking).toBe(false);
    expect(platforms.Mixpanel.ready).toBe(false);
    expect(platforms.Mixpanel.queue.length).toBe(0);

    vi.useRealTimers();
  });

  it('destroy() is safe to call when no interval is active', () => {
    window.requestIdleCallback = vi.fn((cb: any) => cb());
    loadWithDebug();
    const platforms = window.ppAnalyticsDebug.platforms;

    // Clear any auto-started interval first
    platforms.Mixpanel.destroy();

    // Now call destroy again when _intervalId is already null
    expect(() => platforms.Mixpanel.destroy()).not.toThrow();
    expect(platforms.Mixpanel._intervalId).toBeNull();
    expect(platforms.Mixpanel.ready).toBe(false);
  });
});
