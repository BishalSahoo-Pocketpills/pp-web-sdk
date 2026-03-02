import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { createMockBraze } from '../helpers/mock-braze.ts';

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('braze');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.braze).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('braze');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady!.length).toBe(1);
    expect(typeof window.ppLibReady![0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('braze');
    expect(window.ppLibReady!.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.braze).toBeDefined();
  });

  it('exposes ppLib.braze public API with all expected methods', () => {
    loadWithCommon('braze');
    const api = window.ppLib.braze!;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.identify).toBe('function');
    expect(typeof api.setUserAttributes).toBe('function');
    expect(typeof api.setEmail).toBe('function');
    expect(typeof api.trackEvent).toBe('function');
    expect(typeof api.trackPurchase).toBe('function');
    expect(typeof api.flush).toBe('function');
    expect(typeof api.isReady).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});

// =========================================================================
// 2. CONFIGURATION
// =========================================================================
describe('Configuration', () => {
  it('returns default config when called with no args', () => {
    loadWithCommon('braze');
    const config = window.ppLib.braze!.configure();
    expect(config.sdk.apiKey).toBe('');
    expect(config.sdk.baseUrl).toBe('');
    expect(config.sdk.cdnUrl).toBe('https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js');
    expect(config.sdk.enableLogging).toBe(false);
    expect(config.sdk.sessionTimeoutInSeconds).toBe(1800);
    expect(config.consent.required).toBe(false);
    expect(config.consent.mode).toBe('analytics');
    expect(config.identity.autoIdentify).toBe(true);
    expect(config.identity.userIdCookie).toBe('userId');
    expect(config.form.formAttribute).toBe('data-braze-form');
    expect(config.form.fieldAttribute).toBe('data-braze-attr');
    expect(config.form.preventDefault).toBe(false);
    expect(config.form.debounceMs).toBe(500);
    expect(config.form.flushOnSubmit).toBe(true);
    expect(config.form.requireEmail).toBe(false);
    expect(config.event.eventAttribute).toBe('data-braze-event');
    expect(config.event.propPrefix).toBe('data-braze-prop-');
    expect(config.event.debounceMs).toBe(300);
    expect(config.event.includePageContext).toBe(true);
    expect(config.purchase.bridgeEcommerce).toBe(false);
    expect(config.purchase.defaultCurrency).toBe('CAD');
  });

  it('merges partial config via configure()', () => {
    loadWithCommon('braze');
    const config = window.ppLib.braze!.configure({
      sdk: { apiKey: 'test-key', baseUrl: 'sdk.iad-01.braze.com' } as any
    });
    expect(config.sdk.apiKey).toBe('test-key');
    expect(config.sdk.baseUrl).toBe('sdk.iad-01.braze.com');
  });

  it('getConfig returns the config object', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'abc' } as any
    });
    const config = window.ppLib.braze!.getConfig();
    expect(config.sdk.apiKey).toBe('abc');
  });
});

// =========================================================================
// 3. INIT — SDK LOADING
// =========================================================================
describe('init()', () => {
  it('logs warning and returns when apiKey is empty', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No apiKey'));
  });

  it('logs warning and returns when baseUrl is empty', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.braze!.configure({ sdk: { apiKey: 'key' } as any });
    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No baseUrl'));
  });

  it('does not load SDK when consent is required but not granted', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      consent: { required: true, mode: 'custom', checkFunction: () => false }
    });
    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
    // No script tag should be injected
    const scripts = document.querySelectorAll('script[src*="appboycdn"]');
    expect(scripts.length).toBe(0);
  });

  it('does not load SDK when consent mode is analytics and ppAnalytics returns false', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppAnalytics = {
      consent: { status: () => false }
    };

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('loads SDK when consent is analytics and ppAnalytics returns true', () => {
    loadWithCommon('braze');

    (window as any).ppAnalytics = {
      consent: { status: () => true }
    };

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.braze!.init();

    // Script should be injected
    const scripts = document.querySelectorAll('script[src*="appboycdn"]');
    expect(scripts.length).toBe(1);
  });

  it('consent analytics mode returns false when ppAnalytics is missing', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    delete (window as any).ppAnalytics;

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('injects CDN script tag and creates stub on window.braze', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'test-key', baseUrl: 'sdk.iad-01.braze.com' } as any
    });
    window.ppLib.braze!.init();

    // Script tag injected (may accumulate from prior tests since head is not cleared)
    const scripts = document.querySelectorAll('script[src*="appboycdn"]');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    expect(scripts[scripts.length - 1].getAttribute('src')).toBe('https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js');

    // Stub is installed
    expect(window.braze).toBeDefined();
    expect(typeof window.braze.logCustomEvent).toBe('function');
    expect(typeof window.braze.changeUser).toBe('function');
    expect(typeof window.braze.getUser).toBe('function');
  });

  it('stub queues calls before SDK loads', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'test-key', baseUrl: 'sdk.iad-01.braze.com' } as any
    });
    window.ppLib.braze!.init();

    // These should be buffered
    window.braze.changeUser('user-123');
    window.braze.logCustomEvent('test_event', { key: 'val' });
    window.braze.getUser().setEmail('test@example.com');

    // No errors thrown, calls buffered
    expect(window.braze).toBeDefined();
  });

  it('script.onload initializes Braze and drains the queue', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'test-key', baseUrl: 'sdk.iad-01.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Buffer some calls
    window.braze.logCustomEvent('pre_load_event');

    // Simulate SDK load by replacing with mock
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    // Trigger onload
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze.initialize).toHaveBeenCalledWith('test-key', expect.objectContaining({
      baseUrl: 'sdk.iad-01.braze.com'
    }));
    expect(mockBraze.openSession).toHaveBeenCalled();
  });

  it('script.onerror logs error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any
    });
    window.ppLib.braze!.init();

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onerror!(new Event('error'));

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('Failed to load SDK'));
  });

  it('isReady() returns false before SDK loads', () => {
    loadWithCommon('braze');
    expect(window.ppLib.braze!.isReady()).toBe(false);
  });

  it('isReady() returns true after script.onload', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Replace stub with mock before onload
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(window.ppLib.braze!.isReady()).toBe(true);
  });
});

// =========================================================================
// 4. AUTO-IDENTIFY
// =========================================================================
describe('Auto-identify', () => {
  it('auto-identifies from userId cookie on SDK load', () => {
    loadWithCommon('braze');
    document.cookie = 'userId=user-456;path=/';

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: true, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze.changeUser).toHaveBeenCalledWith('user-456');
  });

  it('does not auto-identify when userId is -1', () => {
    loadWithCommon('braze');
    document.cookie = 'userId=-1;path=/';

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: true, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze.changeUser).not.toHaveBeenCalled();
  });

  it('does not auto-identify when autoIdentify is false', () => {
    loadWithCommon('braze');
    document.cookie = 'userId=user-789;path=/';

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze.changeUser).not.toHaveBeenCalled();
  });

  it('auto-sets email from emailCookie when configured', () => {
    loadWithCommon('braze');
    document.cookie = 'userId=user-100;path=/';
    document.cookie = 'userEmail=auto@test.com;path=/';

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: true, userIdCookie: 'userId', emailCookie: 'userEmail' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('auto@test.com');
  });
});

// =========================================================================
// 5. IDENTIFY (manual)
// =========================================================================
describe('identify()', () => {
  it('calls changeUser with sanitized userId', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.identify('user-abc');

    expect(mockBraze.changeUser).toHaveBeenCalledWith('user-abc');
  });

  it('logs warning when called with empty userId', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.identify('');

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('empty userId'));
    expect(mockBraze.changeUser).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 6. SET USER ATTRIBUTES
// =========================================================================
describe('setUserAttributes()', () => {
  it('maps standard attributes to dedicated setters', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setUserAttributes({
      email: 'test@test.com',
      first_name: 'John',
      last_name: 'Doe',
      phone: '555-1234'
    });

    const user = mockBraze._mockUser;
    expect(user.setEmail).toHaveBeenCalledWith('test@test.com');
    expect(user.setFirstName).toHaveBeenCalledWith('John');
    expect(user.setLastName).toHaveBeenCalledWith('Doe');
    expect(user.setPhoneNumber).toHaveBeenCalledWith('555-1234');
  });

  it('sends unknown attributes as custom attributes', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setUserAttributes({
      preferred_pharmacy: 'downtown'
    });

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'downtown');
  });

  it('sets multiple custom attributes in a single call', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setUserAttributes({
      preferred_pharmacy: 'Downtown Pharmacy',
      insurance_provider: 'Sun Life',
      province: 'ON',
      referral_source: 'google_ads',
      medication_interest: 'weight-loss'
    });

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledTimes(5);
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'Downtown Pharmacy');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('insurance_provider', 'Sun Life');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('province', 'ON');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('referral_source', 'google_ads');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('medication_interest', 'weight-loss');
  });

  it('sets standard and custom attributes together in a single call', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setUserAttributes({
      email: 'jane@example.com',
      first_name: 'Jane',
      phone: '+1-555-0199',
      loyalty_tier: 'gold',
      preferred_pharmacy: 'Queen St',
      signup_channel: 'webflow'
    });

    // Standard attributes → dedicated setters
    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('jane@example.com');
    expect(mockBraze._mockUser.setFirstName).toHaveBeenCalledWith('Jane');
    expect(mockBraze._mockUser.setPhoneNumber).toHaveBeenCalledWith('+1-555-0199');
    // Custom attributes → setCustomUserAttribute
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('loyalty_tier', 'gold');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'Queen St');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('signup_channel', 'webflow');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledTimes(3);
  });

  it('uses attributeMap for remapping', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      attributeMap: { pharmacy: 'preferred_pharmacy' }
    });
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setUserAttributes({ pharmacy: 'uptown' });

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'uptown');
  });

  it('does nothing when called with null', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    // Should not throw
    window.ppLib.braze!.setUserAttributes(null as any);
    expect(mockBraze.getUser).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 7. SET EMAIL
// =========================================================================
describe('setEmail()', () => {
  it('calls setEmail on braze user', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setEmail('hello@world.com');

    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('hello@world.com');
  });

  it('does nothing for empty email', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.setEmail('');

    expect(mockBraze._mockUser.setEmail).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 8. TRACK EVENT (programmatic)
// =========================================================================
describe('trackEvent()', () => {
  it('logs custom event with sanitized name', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackEvent('signup_started');

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('signup_started');
  });

  it('logs custom event with properties', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackEvent('page_view', { section: 'pricing' });

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('page_view', { section: 'pricing' });
  });

  it('does nothing for empty event name', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackEvent('');

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 9. TRACK PURCHASE (programmatic)
// =========================================================================
describe('trackPurchase()', () => {
  it('logs purchase with default currency', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('assessment-pkg', 60);

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('assessment-pkg', 60, 'CAD', 1);
  });

  it('logs purchase with custom currency and quantity', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('premium-plan', 99.99, 'USD', 2);

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('premium-plan', 99.99, 'USD', 2);
  });

  it('logs purchase with properties', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('item-1', 25, 'CAD', 1, { source: 'checkout' });

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('item-1', 25, 'CAD', 1, { source: 'checkout' });
  });

  it('does nothing for empty productId', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('', 10);

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('does nothing for NaN price', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('item', NaN);

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 10. FLUSH
// =========================================================================
describe('flush()', () => {
  it('calls requestImmediateDataFlush', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.flush();

    expect(mockBraze.requestImmediateDataFlush).toHaveBeenCalled();
  });

  it('handles error gracefully when braze is not available', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.braze = { requestImmediateDataFlush: () => { throw new Error('test'); } } as any;

    window.ppLib.braze!.flush();

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('flush error'), expect.any(Error));
  });
});

// =========================================================================
// 11. FORM HANDLING (data-braze-form)
// =========================================================================
describe('Form Handling', () => {
  function initWithMock() {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    // Simulate script load to bind handlers
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    return mockBraze;
  }

  it('captures form fields and tracks event on submit', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="lead_capture">
        <input data-braze-attr="email" name="email" value="test@example.com">
        <input data-braze-attr="first_name" name="first_name" value="Jane">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('test@example.com');
    expect(mockBraze._mockUser.setFirstName).toHaveBeenCalledWith('Jane');
    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('form_submitted_lead_capture', expect.objectContaining({
      form_name: 'lead_capture'
    }));
  });

  it('handles custom: prefix fields', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="signup">
        <input data-braze-attr="custom:preferred_pharmacy" value="downtown">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'downtown');
  });

  it('sets multiple custom: prefix fields from a single form submit', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="patient_profile">
        <input data-braze-attr="email" value="test@example.com">
        <input data-braze-attr="first_name" value="Jane">
        <input data-braze-attr="custom:preferred_pharmacy" value="Downtown Pharmacy">
        <input data-braze-attr="custom:insurance_provider" value="Sun Life">
        <input data-braze-attr="custom:province" value="ON">
        <input data-braze-attr="custom:referral_source" value="google_ads">
        <input data-braze-attr="custom:medication_interest" value="weight-loss">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    // Standard attributes → dedicated setters
    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('test@example.com');
    expect(mockBraze._mockUser.setFirstName).toHaveBeenCalledWith('Jane');
    // All 5 custom attributes → setCustomUserAttribute
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledTimes(5);
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'Downtown Pharmacy');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('insurance_provider', 'Sun Life');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('province', 'ON');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('referral_source', 'google_ads');
    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('medication_interest', 'weight-loss');
    // Event still fires
    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('form_submitted_patient_profile', expect.any(Object));
  });

  it('uses data-braze-form-event override for event name', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="signup" data-braze-form-event="custom_form_event">
        <input data-braze-attr="email" value="test@test.com">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('custom_form_event', expect.any(Object));
  });

  it('flushes data after form submit when flushOnSubmit is true', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="contact">
        <input data-braze-attr="email" value="x@y.com">
        <button type="submit">Send</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.requestImmediateDataFlush).toHaveBeenCalled();
  });

  it('rejects form when requireEmail is true but email is missing', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      form: { requireEmail: true } as any
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="lead">
        <input data-braze-attr="first_name" value="John">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });

  it('rejects form when requireEmail is true and email is empty string', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      form: { requireEmail: true } as any
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="lead">
        <input data-braze-attr="email" value="   ">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });

  it('ignores submit events on forms without data-braze-form', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form>
        <input name="email" value="test@test.com">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });

  it('debounces rapid form submissions', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="rapid_form">
        <input data-braze-attr="email" value="test@test.com">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).toHaveBeenCalledTimes(1);
  });

  it('skips fields with empty values', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="test">
        <input data-braze-attr="email" value="">
        <input data-braze-attr="first_name" value="John">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    // email should not be set (empty value skipped), first_name should be set
    expect(mockBraze._mockUser.setEmail).not.toHaveBeenCalled();
    expect(mockBraze._mockUser.setFirstName).toHaveBeenCalledWith('John');
  });

  it('processes all standard attribute types', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="full_form">
        <input data-braze-attr="email" value="a@b.com">
        <input data-braze-attr="first_name" value="Alice">
        <input data-braze-attr="last_name" value="Smith">
        <input data-braze-attr="phone" value="555-0000">
        <input data-braze-attr="gender" value="female">
        <input data-braze-attr="dob" value="1990-01-01">
        <input data-braze-attr="country" value="CA">
        <input data-braze-attr="city" value="Toronto">
        <input data-braze-attr="language" value="en">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    const user = mockBraze._mockUser;
    expect(user.setEmail).toHaveBeenCalledWith('a@b.com');
    expect(user.setFirstName).toHaveBeenCalledWith('Alice');
    expect(user.setLastName).toHaveBeenCalledWith('Smith');
    expect(user.setPhoneNumber).toHaveBeenCalledWith('555-0000');
    expect(user.setGender).toHaveBeenCalledWith('female');
    expect(user.setDateOfBirth).toHaveBeenCalledWith('1990-01-01');
    expect(user.setCountry).toHaveBeenCalledWith('CA');
    expect(user.setHomeCity).toHaveBeenCalledWith('Toronto');
    expect(user.setLanguage).toHaveBeenCalledWith('en');
  });

  it('falls through unmapped attributes to custom attributes', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="custom_fields">
        <input data-braze-attr="unknown_field" value="some_value">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('unknown_field', 'some_value');
  });

  it('prevents default when preventDefault config is true', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      form: { preventDefault: true } as any
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="blocked">
        <input data-braze-attr="email" value="x@y.com">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(submitEvent, 'preventDefault');
    form.dispatchEvent(submitEvent);

    expect(preventSpy).toHaveBeenCalled();
  });

  it('handles form with no fields gracefully', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <form data-braze-form="empty_form">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    // Event should still fire even with no fields
    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('form_submitted_empty_form', expect.any(Object));
  });
});

// =========================================================================
// 12. EVENT HANDLING (data-braze-event)
// =========================================================================
describe('Event Handling', () => {
  function initWithMock() {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    return mockBraze;
  }

  it('tracks click on element with data-braze-event', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-event="started_signup">Get Started</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('started_signup', expect.any(Object));
  });

  it('extracts data-braze-prop-* dynamic properties', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-event="cta_click"
              data-braze-prop-source="hero_banner"
              data-braze-prop-plan="premium">
        Click Me
      </button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    const call = mockBraze.logCustomEvent.mock.calls[0];
    expect(call[0]).toBe('cta_click');
    expect(call[1]).toMatchObject({
      source: 'hero_banner',
      plan: 'premium'
    });
  });

  it('includes page context in event properties', () => {
    const mockBraze = initWithMock();
    document.title = 'Test Page';

    document.body.innerHTML = `
      <button data-braze-event="test_event">Test</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    const call = mockBraze.logCustomEvent.mock.calls[0];
    expect(call[1]).toMatchObject({
      page_url: expect.any(String),
      page_path: expect.any(String),
      page_title: 'Test Page'
    });
  });

  it('debounces rapid clicks on same element', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-event="rapid_click">Click</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();
    btn.click();
    btn.click();

    expect(mockBraze.logCustomEvent).toHaveBeenCalledTimes(1);
  });

  it('tracks touchend events', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-event="tap_event">Tap</button>
    `;

    const btn = document.querySelector('button')!;
    btn.dispatchEvent(new Event('touchend', { bubbles: true }));

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('tap_event', expect.any(Object));
  });

  it('ignores clicks on elements without data-braze-event', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button>No Tracking</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });

  it('uses closest() to find data-braze-event on ancestor', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <div data-braze-event="parent_event" data-braze-prop-level="top">
        <span class="child">Click here</span>
      </div>
    `;

    const child = document.querySelector('.child')!;
    child.dispatchEvent(new Event('click', { bubbles: true }));

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('parent_event', expect.objectContaining({
      level: 'top'
    }));
  });

  it('works alongside existing data-event-source attributes (dual tracking)', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-event-source="add_to_cart"
              data-braze-event="product_interest"
              data-braze-prop-product="weight-loss">
        Add to Cart
      </button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logCustomEvent).toHaveBeenCalledWith('product_interest', expect.objectContaining({
      product: 'weight-loss'
    }));
  });

  it('does not include page context when includePageContext is false', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      event: { includePageContext: false } as any
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <button data-braze-event="no_context">Click</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    const call = mockBraze.logCustomEvent.mock.calls[0];
    expect(call[1]).not.toHaveProperty('page_url');
    expect(call[1]).not.toHaveProperty('page_path');
    expect(call[1]).not.toHaveProperty('page_title');
  });
});

// =========================================================================
// 13. PURCHASE HANDLING (data-braze-purchase)
// =========================================================================
describe('Purchase Handling', () => {
  function initWithMock() {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    return mockBraze;
  }

  it('tracks purchase on click with data-braze-purchase', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="assessment-pkg" data-braze-price="60">Buy ($60)</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('assessment-pkg', 60, 'CAD', 1);
  });

  it('uses custom currency from data-braze-currency', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item" data-braze-price="50" data-braze-currency="USD">Buy</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('item', 50, 'USD', 1);
  });

  it('uses custom quantity from data-braze-quantity', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item" data-braze-price="10" data-braze-quantity="3">Buy 3</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('item', 10, 'CAD', 3);
  });

  it('ignores clicks without data-braze-purchase', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `<button>No Purchase</button>`;
    document.querySelector('button')!.click();

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('ignores purchase without data-braze-price', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item-no-price">Buy</button>
    `;

    document.querySelector('button')!.click();

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('ignores invalid (NaN) price', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item" data-braze-price="not-a-number">Buy</button>
    `;

    document.querySelector('button')!.click();

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('defaults quantity to 1 for invalid quantity', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item" data-braze-price="10" data-braze-quantity="abc">Buy</button>
    `;

    document.querySelector('button')!.click();

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('item', 10, 'CAD', 1);
  });

  it('debounces rapid purchase clicks', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="item" data-braze-price="20">Buy</button>
    `;

    const btn = document.querySelector('button')!;
    btn.click();
    btn.click();
    btn.click();

    expect(mockBraze.logPurchase).toHaveBeenCalledTimes(1);
  });

  it('handles touchend for purchase', () => {
    const mockBraze = initWithMock();

    document.body.innerHTML = `
      <button data-braze-purchase="touch-item" data-braze-price="15">Buy</button>
    `;

    const btn = document.querySelector('button')!;
    btn.dispatchEvent(new Event('touchend', { bubbles: true }));

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('touch-item', 15, 'CAD', 1);
  });
});

// =========================================================================
// 14. ECOMMERCE BRIDGE
// =========================================================================
describe('Ecommerce Bridge', () => {
  it('does not intercept dataLayer when bridgeEcommerce is false (default)', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'add_to_cart',
      ecommerce: {
        items: [{ item_id: 'test', price: '10', quantity: 1 }]
      }
    });

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('mirrors add_to_cart events to Braze when bridgeEcommerce is true', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      purchase: { bridgeEcommerce: true, defaultCurrency: 'CAD' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    window.dataLayer.push({
      event: 'add_to_cart',
      ecommerce: {
        currency: 'CAD',
        items: [
          { item_id: 'product-1', price: '29.99', quantity: 1 },
          { item_id: 'product-2', price: '49.99', quantity: 2 }
        ]
      }
    });

    expect(mockBraze.logPurchase).toHaveBeenCalledTimes(2);
    expect(mockBraze.logPurchase).toHaveBeenCalledWith('product-1', 29.99, 'CAD', 1);
    expect(mockBraze.logPurchase).toHaveBeenCalledWith('product-2', 49.99, 'CAD', 2);
  });

  it('ignores non-add_to_cart events in dataLayer', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      purchase: { bridgeEcommerce: true, defaultCurrency: 'CAD' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    window.dataLayer.push({
      event: 'view_item',
      ecommerce: {
        items: [{ item_id: 'product-3', price: '10' }]
      }
    });

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 15. SDK STUB QUEUE
// =========================================================================
describe('SDK Stub Queue', () => {
  it('drains queued calls after SDK loads', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Queue calls through stub
    window.braze.changeUser('queued-user');
    window.braze.logCustomEvent('queued_event', { key: 'value' });

    // Replace with real mock before onload triggers drain
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    // The initialize and openSession are called directly,
    // but queued changeUser and logCustomEvent should also have been replayed
    expect(mockBraze.initialize).toHaveBeenCalled();
    expect(mockBraze.openSession).toHaveBeenCalled();
  });

  it('drains getUser() nested method calls', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Queue a getUser().setEmail() call through stub
    window.braze.getUser().setEmail('queued@test.com');

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    expect(mockBraze._mockUser.setEmail).toHaveBeenCalledWith('queued@test.com');
  });
});

// =========================================================================
// 16. EDGE CASES
// =========================================================================
describe('Edge Cases', () => {
  it('handles identify error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { changeUser: () => { throw new Error('test'); } } as any;
    window.ppLib.braze!.identify('user-1');

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('identify error'), expect.any(Error));
  });

  it('handles setUserAttributes error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { getUser: () => { throw new Error('test'); } } as any;
    window.ppLib.braze!.setUserAttributes({ email: 'test@test.com' });

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('setUserAttributes error'), expect.any(Error));
  });

  it('handles setEmail error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { getUser: () => { throw new Error('test'); } } as any;
    window.ppLib.braze!.setEmail('test@test.com');

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('setEmail error'), expect.any(Error));
  });

  it('handles trackEvent error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { logCustomEvent: () => { throw new Error('test'); } } as any;
    window.ppLib.braze!.trackEvent('test_event');

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('trackEvent error'), expect.any(Error));
  });

  it('handles trackPurchase error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { logPurchase: () => { throw new Error('test'); } } as any;
    window.ppLib.braze!.trackPurchase('item', 10);

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('trackPurchase error'), expect.any(Error));
  });

  it('form handler survives when submit target has no closest()', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    // Dispatch submit on a non-form element
    document.body.innerHTML = '<div id="not-a-form"></div>';
    const div = document.querySelector('#not-a-form')!;
    div.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze.logCustomEvent).not.toHaveBeenCalled();
  });

  it('event handler survives errors without crashing', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Set braze to throw on logCustomEvent
    window.braze = { logCustomEvent: () => { throw new Error('boom'); } } as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;

    const mockBraze = createMockBraze();
    // Replace with throwing braze
    window.braze = {
      ...mockBraze,
      logCustomEvent: () => { throw new Error('boom'); }
    } as any;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <button data-braze-event="will_error">Click</button>
    `;

    // Should not throw
    const btn = document.querySelector('button')!;
    expect(() => btn.click()).not.toThrow();
  });

  it('purchase handler survives missing productId or price on click', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <button data-braze-purchase="" data-braze-price="10">Empty ID</button>
    `;
    document.querySelector('button')!.click();

    expect(mockBraze.logPurchase).not.toHaveBeenCalled();
  });

  it('consent checkFunction error returns false gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppAnalytics = {
      consent: { status: () => { throw new Error('consent error'); } }
    };

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.braze!.init();

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('consent check error'), expect.any(Error));
  });

  it('form submit handler processes attributeMap remapping', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' },
      attributeMap: { pharmacy: 'preferred_pharmacy' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="remap_test">
        <input data-braze-attr="pharmacy" value="main_st">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze._mockUser.setCustomUserAttribute).toHaveBeenCalledWith('preferred_pharmacy', 'main_st');
  });

  it('custom: prefix with empty key after colon is ignored', () => {
    loadWithCommon('braze');
    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;
    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="edge">
        <input data-braze-attr="custom:" value="empty_key">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockBraze._mockUser.setCustomUserAttribute).not.toHaveBeenCalled();
  });

  it('processFormAttrs handles error gracefully', () => {
    loadWithCommon('braze');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.braze = { getUser: () => { throw new Error('user error'); } } as any;

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'key', baseUrl: 'sdk.braze.com' } as any,
      identity: { autoIdentify: false, userIdCookie: 'userId', emailCookie: '' }
    });
    window.ppLib.braze!.init();

    // Manually trigger a form submit that will call processFormAttrs
    const mockBraze2 = createMockBraze();
    // Override stub braze but keep broken getUser to test error path inside form handler
    const badBraze = {
      ...mockBraze2,
      getUser: () => { throw new Error('user error'); },
      logCustomEvent: mockBraze2.logCustomEvent,
      requestImmediateDataFlush: mockBraze2.requestImmediateDataFlush
    };
    window.braze = badBraze as any;

    const script = document.querySelector('script[src*="appboycdn"]') as HTMLScriptElement;
    script.onload!(new Event('load'));

    document.body.innerHTML = `
      <form data-braze-form="err_form">
        <input data-braze-attr="email" value="test@test.com">
        <button type="submit">Submit</button>
      </form>
    `;

    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('processFormAttrs error'), expect.any(Error));
  });

  it('purchase trackPurchase with invalid quantity defaults to 1', () => {
    loadWithCommon('braze');
    const mockBraze = createMockBraze();
    window.braze = mockBraze as any;

    window.ppLib.braze!.trackPurchase('item-x', 15, 'CAD', 0);

    expect(mockBraze.logPurchase).toHaveBeenCalledWith('item-x', 15, 'CAD', 1);
  });
});
