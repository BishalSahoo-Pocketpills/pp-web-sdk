import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';

// =========================================================================
// Helper: mock fetch for API calls
// =========================================================================
function mockFetch(response: any, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    json: () => Promise.resolve(response)
  });
}

function mockFetchReject(error: string) {
  return vi.fn().mockRejectedValue(new Error(error));
}

function setupDOM() {
  document.body.innerHTML = `
    <div data-voucherify-product="weight-loss" data-voucherify-base-price="60">
      <span data-voucherify-original-price></span>
      <span data-voucherify-discounted-price></span>
      <span data-voucherify-discount-label></span>
    </div>
    <div data-voucherify-product="hair-loss" data-voucherify-base-price="30">
      <span data-voucherify-original-price></span>
      <span data-voucherify-discounted-price></span>
      <span data-voucherify-discount-label></span>
    </div>
  `;
}

function qualificationsResponse(redeemables: any[] = []) {
  return {
    qualifications: redeemables,
    total: redeemables.length,
    has_more: false
  };
}

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('voucherify');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.voucherify).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('voucherify');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady!.length).toBe(1);
    expect(typeof window.ppLibReady![0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('voucherify');
    expect(window.ppLibReady!.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.voucherify).toBeDefined();
  });

  it('exposes ppLib.voucherify public API with all expected methods', () => {
    loadWithCommon('voucherify');
    const api = window.ppLib.voucherify!;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.fetchPricing).toBe('function');
    expect(typeof api.validateVoucher).toBe('function');
    expect(typeof api.checkQualifications).toBe('function');
    expect(typeof api.clearCache).toBe('function');
    expect(typeof api.isReady).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});

// =========================================================================
// 2. CONFIGURATION
// =========================================================================
describe('Configuration', () => {
  it('returns default config when called with no args', () => {
    loadWithCommon('voucherify');
    const config = window.ppLib.voucherify!.configure();
    expect(config.api.applicationId).toBe('');
    expect(config.api.clientSecretKey).toBe('');
    expect(config.api.baseUrl).toBe('https://as1.api.voucherify.io');
    expect(config.api.origin).toBe('');
    expect(config.cache.enabled).toBe(false);
    expect(config.cache.baseUrl).toBe('/api/voucherify');
    expect(config.cache.ttl).toBe(300000);
    expect(config.pricing.autoFetch).toBe(true);
    expect(config.pricing.productAttribute).toBe('data-voucherify-product');
    expect(config.pricing.originalPriceAttribute).toBe('data-voucherify-original-price');
    expect(config.pricing.discountedPriceAttribute).toBe('data-voucherify-discounted-price');
    expect(config.pricing.discountLabelAttribute).toBe('data-voucherify-discount-label');
    expect(config.pricing.priceAttribute).toBe('data-voucherify-base-price');
    expect(config.pricing.currencySymbol).toBe('$');
    expect(config.pricing.currency).toBe('CAD');
    expect(config.pricing.locale).toBe('en-CA');
    expect(config.context.customerSourceIdCookie).toBe('userId');
    expect(config.context.includeUtmParams).toBe(true);
    expect(config.context.includeLoginState).toBe(true);
    expect(config.consent.required).toBe(false);
    expect(config.consent.mode).toBe('analytics');
    expect(typeof config.consent.checkFunction).toBe('function');
    expect(config.consent.checkFunction()).toBe(true);
  });

  it('merges partial config via configure()', () => {
    loadWithCommon('voucherify');
    const config = window.ppLib.voucherify!.configure({
      api: { applicationId: 'test-app-id', clientSecretKey: 'test-secret' } as any
    });
    expect(config.api.applicationId).toBe('test-app-id');
    expect(config.api.clientSecretKey).toBe('test-secret');
  });

  it('getConfig returns the config object', () => {
    loadWithCommon('voucherify');
    window.ppLib.voucherify!.configure({
      api: { applicationId: 'abc' } as any
    });
    const config = window.ppLib.voucherify!.getConfig();
    expect(config.api.applicationId).toBe('abc');
  });

  it('isReady returns false before init is called', () => {
    loadWithCommon('voucherify');
    expect(window.ppLib.voucherify!.isReady()).toBe(false);
  });

  it('isReady returns true after init is called', () => {
    loadWithCommon('voucherify');
    window.ppLib.voucherify!.configure({
      api: { applicationId: 'test-id' } as any,
      consent: { required: false } as any,
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();
    expect(window.ppLib.voucherify!.isReady()).toBe(true);
  });
});

// =========================================================================
// 3. INIT
// =========================================================================
describe('init()', () => {
  it('logs warning when no applicationId and cache not enabled', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.voucherify!.init();

    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId'));
  });

  it('does not warn when cache.enabled is true even without applicationId', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.fetch = mockFetch(qualificationsResponse());

    window.ppLib.voucherify!.configure({
      cache: { enabled: true } as any,
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).not.toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId'));
  });

  it('does not init when consent required but not granted (custom mode)', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      consent: { required: true, mode: 'custom', checkFunction: () => false },
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('does not init when consent mode is analytics and ppAnalytics returns false', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppAnalytics = {
      consent: { status: () => false }
    };

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true },
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('consent analytics mode returns false when ppAnalytics is missing', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    delete (window as any).ppAnalytics;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true },
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('inits successfully when consent is analytics and ppAnalytics returns true', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.fetch = mockFetch(qualificationsResponse());

    (window as any).ppAnalytics = {
      consent: { status: () => true }
    };

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true },
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).not.toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
  });

  it('consent check handles error in ppAnalytics gracefully', () => {
    loadWithCommon('voucherify');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    (window as any).ppAnalytics = {
      consent: { status: () => { throw new Error('consent error'); } }
    };

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true },
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('consent check error'), expect.any(Error));
  });

  it('auto-fetches pricing when autoFetch is true and DOM is ready', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret' } as any
    });
    window.ppLib.voucherify!.init();

    // Let the promise resolve
    await new Promise(r => setTimeout(r, 10));

    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not auto-fetch when autoFetch is false', () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app-id' } as any,
      pricing: { autoFetch: false } as any
    });
    window.ppLib.voucherify!.init();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 4. API CLIENT — DIRECT MODE
// =========================================================================
describe('API Client — Direct Mode', () => {
  it('sends request to Voucherify API with correct headers', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'my-app-id', clientSecretKey: 'my-secret', baseUrl: 'https://as1.api.voucherify.io' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://as1.api.voucherify.io/client/v1/qualifications',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Client-Application-Id': 'my-app-id',
          'X-Client-Token': 'my-secret'
        }),
        body: expect.any(String)
      })
    );
  });

  it('includes origin header from config or window.location', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key', origin: 'https://pocketpills.com' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders.origin).toBe('https://pocketpills.com');
  });

  it('handles API error response (non-2xx)', async () => {
    loadWithCommon('voucherify');
    window.fetch = mockFetch({}, 400);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await expect(
      window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' })
    ).rejects.toThrow('Voucherify /qualifications: 400');
  });

  it('throws error when applicationId is missing in direct mode', async () => {
    loadWithCommon('voucherify');
    window.fetch = mockFetch({});

    window.ppLib.voucherify!.configure({
      api: { applicationId: '', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await expect(
      window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' })
    ).rejects.toThrow('Voucherify API credentials missing');
  });

  it('throws error when clientSecretKey is missing in direct mode', async () => {
    loadWithCommon('voucherify');
    window.fetch = mockFetch({});

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: '' } as any,
      pricing: { autoFetch: false } as any
    });

    await expect(
      window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' })
    ).rejects.toThrow('Voucherify API credentials missing');
  });
});

// =========================================================================
// 5. API CLIENT — CACHE MODE
// =========================================================================
describe('API Client — Cache Mode', () => {
  it('routes to backend proxy URL when cache.enabled is true', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/voucherify/qualifications',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('does not include Voucherify auth headers in cache mode', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    const callHeaders = fetchMock.mock.calls[0][1].headers;
    expect(callHeaders['X-Client-Application-Id']).toBeUndefined();
    expect(callHeaders['X-Client-Token']).toBeUndefined();
  });
});

// =========================================================================
// 6. IN-MEMORY CACHE
// =========================================================================
describe('In-memory Cache', () => {
  it('returns cached response on second call with same params', async () => {
    loadWithCommon('voucherify');
    const responseData = qualificationsResponse([{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 10 } } }]);
    const fetchMock = mockFetch(responseData);
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result1 = await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });
    const result2 = await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    // Only one fetch call made
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  it('does not cache across different request bodies', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });
    await window.ppLib.voucherify!.checkQualifications({ scenario: 'PRODUCTS' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clearCache forces refetch', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.ppLib.voucherify!.clearCache();

    await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts stale cache entries when cache exceeds 51 entries', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any,
      cache: { ttl: 1 } as any // 1ms TTL so entries expire quickly
    });

    // Make 51 unique API calls to fill the cache past the eviction threshold
    for (let i = 0; i < 51; i++) {
      await window.ppLib.voucherify!.checkQualifications({ ctx: 'entry_' + i });
    }

    // Wait for entries to expire (TTL = 1ms)
    await new Promise(resolve => setTimeout(resolve, 10));

    // This 52nd call triggers eviction: memCache.size > 50 and stale entries get deleted
    await window.ppLib.voucherify!.checkQualifications({ ctx: 'trigger_eviction' });

    // 52 unique requests + any re-fetches after TTL expiry
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(52);
  });
});

// =========================================================================
// 7. CONTEXT BUILDER
// =========================================================================
describe('Context Builder', () => {
  it('includes customer source_id from cookie in qualifications request', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=customer-123;path=/';
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    expect(body.customer.source_id).toBe('customer-123');
  });

  it('includes UTM params in customer metadata', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=user-1;path=/';

    // Mock window.location.href with UTM params
    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer',
        origin: 'https://example.com'
      },
      writable: true,
      configurable: true
    });

    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer.metadata).toBeDefined();
    expect(body.customer.metadata.utm_source).toBe('google');
    expect(body.customer.metadata.utm_medium).toBe('cpc');
    expect(body.customer.metadata.utm_campaign).toBe('summer');
  });

  it('includes login state in customer metadata when login module present', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=user-1;path=/';

    // Mock login module
    (window.ppLib as any).login = {
      isLoggedIn: () => true
    };

    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer.metadata.is_logged_in).toBe(true);
  });

  it('handles anonymous user (no cookie) without customer in request', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toBeUndefined();
  });

  it('excludes login state when includeLoginState is false', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=user-1;path=/';

    (window.ppLib as any).login = {
      isLoggedIn: () => true
    };

    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any,
      context: { includeLoginState: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    // No is_logged_in in metadata
    if (body.customer.metadata) {
      expect(body.customer.metadata.is_logged_in).toBeUndefined();
    }
  });

  it('excludes UTM params when includeUtmParams is false', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=user-1;path=/';

    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://example.com?utm_source=google&utm_medium=cpc&utm_campaign=summer',
        origin: 'https://example.com'
      },
      writable: true,
      configurable: true
    });

    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any,
      context: { includeUtmParams: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    // metadata may exist (from login state) but no UTM keys
    if (body.customer.metadata) {
      expect(body.customer.metadata.utm_source).toBeUndefined();
      expect(body.customer.metadata.utm_medium).toBeUndefined();
      expect(body.customer.metadata.utm_campaign).toBeUndefined();
    }
  });

  it('sends empty metadata when no metadata keys are populated', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    document.cookie = 'userId=user-no-meta;path=/';

    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any,
      context: { includeLoginState: false, includeUtmParams: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    expect(body.customer.source_id).toBe('user-no-meta');
    expect(body.customer.metadata).toEqual({});
  });

  it('builds order items from product IDs', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.order.items).toHaveLength(2);
    expect(body.order.items[0].source_id).toBe('weight-loss');
    expect(body.order.items[0].product_id).toBe('weight-loss');
    expect(body.order.items[0].related_object).toBe('product');
    expect(body.order.items[0].quantity).toBe(1);
    expect(body.order.items[1].source_id).toBe('hair-loss');
  });
});

// =========================================================================
// 8. DOM SCANNING
// =========================================================================
describe('DOM Scanning', () => {
  it('scans DOM for product elements by data attribute', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results).toHaveLength(2);
    expect(results[0].productId).toBe('weight-loss');
    expect(results[0].basePrice).toBe(60);
    expect(results[1].productId).toBe('hair-loss');
    expect(results[1].basePrice).toBe(30);
  });

  it('returns empty array when no product elements in DOM', async () => {
    loadWithCommon('voucherify');
    document.body.innerHTML = '<div>No products here</div>';
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts explicit product IDs overriding DOM scan', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing(['custom-product']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.order.items).toHaveLength(1);
    expect(body.order.items[0].source_id).toBe('custom-product');
    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('custom-product');
  });

  it('skips elements without an id (empty attribute) and logs warning', async () => {
    loadWithCommon('voucherify');
    document.body.innerHTML = `
      <div data-voucherify-product="" data-voucherify-base-price="10">
        <span data-voucherify-original-price></span>
      </div>
      <div data-voucherify-product="valid-product" data-voucherify-base-price="20">
        <span data-voucherify-original-price></span>
      </div>
    `;
    const fetchMock = mockFetch(qualificationsResponse());
    window.fetch = fetchMock;
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('valid-product');
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('empty product ID'));
  });
});

// =========================================================================
// 9. PRICING — PERCENT DISCOUNT
// =========================================================================
describe('Pricing — Percent Discount', () => {
  it('injects original and discounted prices for percent discount', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'voucher-25-off',
      result: { discount: { type: 'PERCENT', percent_off: 25 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - 25% = 45
    expect(results[0].discountedPrice).toBe(45);
    expect(results[0].discountAmount).toBe(15);
    expect(results[0].discountType).toBe('PERCENT');
    expect(results[0].discountLabel).toBe('25% OFF');
    expect(results[0].applicableVouchers).toContain('voucher-25-off');

    // Check DOM injection
    const weightLossEl = document.querySelector('[data-voucherify-product="weight-loss"]')!;
    const originalPrice = weightLossEl.querySelector('[data-voucherify-original-price]')!;
    const discountedPrice = weightLossEl.querySelector('[data-voucherify-discounted-price]')!;
    const discountLabel = weightLossEl.querySelector('[data-voucherify-discount-label]')!;

    expect(originalPrice.textContent).toContain('60');
    expect(discountedPrice.textContent).toContain('45');
    expect(discountLabel.textContent).toBe('25% OFF');
  });
});

// =========================================================================
// 9b. PRICING — Nested redeemables.data format (real Voucherify response)
// =========================================================================
describe('Pricing — Nested redeemables.data response format', () => {
  it('parses redeemables from nested { redeemables: { data: [...] } } structure', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    // Real Voucherify response wraps redeemables in { object: "list", data: [...] }
    const response = {
      redeemables: {
        object: 'list',
        data_ref: 'data',
        data: [{
          id: 'promo_tier_1',
          object: 'promotion_tier',
          result: { discount: { type: 'PERCENT', percent_off: 15 } }
        }]
      },
      total: 1,
      has_more: false
    };
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - 15% = 51
    expect(results[0].discountedPrice).toBe(51);
    expect(results[0].discountAmount).toBe(9);
    expect(results[0].discountType).toBe('PERCENT');
    expect(results[0].discountLabel).toBe('15% OFF');
  });
});

// =========================================================================
// 10. PRICING — AMOUNT DISCOUNT
// =========================================================================
describe('Pricing — Amount Discount', () => {
  it('handles amount discount (cents to dollars)', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'voucher-10-dollars',
      result: { discount: { type: 'AMOUNT', amount_off: 1000 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - $10 = 50
    expect(results[0].discountedPrice).toBe(50);
    expect(results[0].discountAmount).toBe(10);
    expect(results[0].discountType).toBe('AMOUNT');
    expect(results[0].discountLabel).toContain('10');
    expect(results[0].discountLabel).toContain('OFF');
  });
});

// =========================================================================
// 11. PRICING — NO DISCOUNT
// =========================================================================
describe('Pricing — No Discount', () => {
  it('shows base price when no discounts apply', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    window.fetch = mockFetch(qualificationsResponse());

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results[0].discountedPrice).toBe(60);
    expect(results[0].discountAmount).toBe(0);
    expect(results[0].discountType).toBe('NONE');
    expect(results[0].discountLabel).toBe('');

    // Discounted price shows base price when no discount
    const el = document.querySelector('[data-voucherify-product="weight-loss"]')!;
    const discountedPrice = el.querySelector('[data-voucherify-discounted-price]')!;
    expect(discountedPrice.textContent).toContain('60');

    // Label should be empty
    const label = el.querySelector('[data-voucherify-discount-label]')!;
    expect(label.textContent).toBe('');
  });
});

// =========================================================================
// 12. PRICING — FIXED DISCOUNT
// =========================================================================
describe('Pricing — Fixed Discount', () => {
  it('handles fixed discount (final price)', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'voucher-fixed',
      result: { discount: { type: 'FIXED', fixed_amount: 4500 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - (60 - 45) = 45
    expect(results[0].discountedPrice).toBe(45);
    expect(results[0].discountAmount).toBe(15);
    expect(results[0].discountType).toBe('FIXED');
  });
});

// =========================================================================
// 13. PRICING — UNIT DISCOUNT
// =========================================================================
describe('Pricing — Unit Discount', () => {
  it('handles unit discount', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'voucher-unit',
      result: { discount: { type: 'UNIT', unit_off: 0.5 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - (0.5 * 60) = 30
    expect(results[0].discountedPrice).toBe(30);
    expect(results[0].discountAmount).toBe(30);
    expect(results[0].discountType).toBe('UNIT');
  });
});

// =========================================================================
// 14. PRICING — BEST DISCOUNT
// =========================================================================
describe('Pricing — Best Discount Selection', () => {
  it('selects best discount when multiple redeemables apply', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([
      { id: 'small', result: { discount: { type: 'PERCENT', percent_off: 10 } } },
      { id: 'large', result: { discount: { type: 'PERCENT', percent_off: 50 } } }
    ]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    // weight-loss: 60 - 50% = 30 (the larger discount wins)
    expect(results[0].discountedPrice).toBe(30);
    expect(results[0].discountAmount).toBe(30);
    expect(results[0].applicableVouchers).toEqual(['small', 'large']);
  });
});

// =========================================================================
// 15. PRICING — ERROR HANDLING
// =========================================================================
describe('Pricing — Error Handling', () => {
  it('returns empty array and logs error on fetch failure', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    window.fetch = mockFetchReject('Network error');
    const logSpy = vi.spyOn(window.ppLib, 'log');

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
  });

  it('handles response with missing qualifications gracefully', async () => {
    loadWithCommon('voucherify');
    setupDOM();
    window.fetch = mockFetch({});

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results).toHaveLength(2);
    expect(results[0].discountType).toBe('NONE');
    expect(results[1].discountType).toBe('NONE');
  });

  it('handles redeemables key in response (alternative format)', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = {
      redeemables: [{
        id: 'alt-voucher',
        result: { discount: { type: 'PERCENT', percent_off: 20 } }
      }]
    };
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results[0].discountedPrice).toBe(48); // 60 - 20% = 48
    expect(results[0].discountType).toBe('PERCENT');
  });
});

// =========================================================================
// 16. VALIDATE VOUCHER
// =========================================================================
describe('validateVoucher()', () => {
  it('sends correct validation request for a voucher code', async () => {
    loadWithCommon('voucherify');

    const validResponse = {
      redeemables: [{
        status: 'APPLICABLE',
        id: 'SUMMER25',
        result: {
          discount: { type: 'PERCENT', percent_off: 25 },
          order: { amount: 6000, discount_amount: 1500, total_amount: 4500 }
        }
      }]
    };
    const fetchMock = mockFetch(validResponse);
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result = await window.ppLib.voucherify!.validateVoucher('SUMMER25');

    expect(result.valid).toBe(true);
    expect(result.code).toBe('SUMMER25');
    expect(result.discount).toEqual({ type: 'PERCENT', percent_off: 25 });
    expect(result.order!.discount_amount).toBe(1500);

    // Verify the request body
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.redeemables).toEqual([{ object: 'voucher', id: 'SUMMER25' }]);
  });

  it('returns invalid result for non-applicable voucher', async () => {
    loadWithCommon('voucherify');

    const invalidResponse = {
      redeemables: [{
        status: 'INAPPLICABLE',
        id: 'EXPIRED',
        result: {}
      }]
    };
    window.fetch = mockFetch(invalidResponse);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result = await window.ppLib.voucherify!.validateVoucher('EXPIRED');

    expect(result.valid).toBe(false);
    expect(result.code).toBe('EXPIRED');
    expect(result.reason).toBe('INAPPLICABLE');
  });

  it('handles empty voucher code', async () => {
    loadWithCommon('voucherify');

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result = await window.ppLib.voucherify!.validateVoucher('');

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Empty voucher code');
  });

  it('includes customer and order context when provided', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch({ redeemables: [{ status: 'APPLICABLE', id: 'CODE', result: {} }] });
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.validateVoucher('CODE', {
      customer: { source_id: 'cust-1' },
      order: { amount: 5000 }
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toEqual({ source_id: 'cust-1' });
    expect(body.order).toEqual({ amount: 5000 });
  });

  it('includes customer only when order is not provided', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch({ redeemables: [{ status: 'APPLICABLE', id: 'CODE', result: {} }] });
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.validateVoucher('CODE', {
      customer: { source_id: 'cust-2' }
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customer).toEqual({ source_id: 'cust-2' });
    expect(body.order).toBeUndefined();
  });
});

// =========================================================================
// 17. CHECK QUALIFICATIONS
// =========================================================================
describe('checkQualifications()', () => {
  it('returns mapped qualification result', async () => {
    loadWithCommon('voucherify');

    const response = {
      redeemables: [
        { id: 'v1', object: 'voucher', result: { discount: { type: 'PERCENT', percent_off: 10 } } },
        { id: 'c1', object: 'campaign', result: { discount: { type: 'AMOUNT', amount_off: 500 } } }
      ],
      total: 2,
      has_more: false
    };
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result = await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    expect(result.redeemables).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('defaults scenario to ALL when no context provided', async () => {
    loadWithCommon('voucherify');
    const fetchMock = mockFetch({ redeemables: [], total: 0, has_more: false });
    window.fetch = fetchMock;

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.checkQualifications();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.scenario).toBe('ALL');
  });

  it('handles response with missing fields and truthy has_more', async () => {
    loadWithCommon('voucherify');
    window.fetch = mockFetch({ has_more: true, total: 5 });

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const result = await window.ppLib.voucherify!.checkQualifications({ scenario: 'ALL' });

    expect(result.redeemables).toEqual([]);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
  });
});

// =========================================================================
// 18. PRICE FORMATTING
// =========================================================================
describe('Price Formatting', () => {
  it('formats prices using Intl.NumberFormat with configured locale', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'v1',
      result: { discount: { type: 'PERCENT', percent_off: 50 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false, currency: 'CAD', locale: 'en-CA' } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    // Check that the DOM has formatted prices (currency symbol present)
    const el = document.querySelector('[data-voucherify-product="weight-loss"]')!;
    const originalPrice = el.querySelector('[data-voucherify-original-price]')!;
    const discountedPrice = el.querySelector('[data-voucherify-discounted-price]')!;

    // The format depends on locale, but should contain the price values
    expect(originalPrice.textContent).toContain('60');
    expect(discountedPrice.textContent).toContain('30');
  });
});

// =========================================================================
// 19. DOM INJECTION EDGE CASES
// =========================================================================
describe('DOM Injection Edge Cases', () => {
  it('does not crash when injection target elements are missing', async () => {
    loadWithCommon('voucherify');

    // Product element exists but no child injection targets
    document.body.innerHTML = `
      <div data-voucherify-product="solo" data-voucherify-base-price="99"></div>
    `;

    const response = qualificationsResponse([{
      id: 'v1',
      result: { discount: { type: 'PERCENT', percent_off: 10 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    // Should not throw
    const results = await window.ppLib.voucherify!.fetchPricing();
    expect(results).toHaveLength(1);
    expect(results[0].discountedPrice).toBeCloseTo(89.1, 1);
  });

  it('clears discount label when no discount applies', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    // Pre-set label content to verify it gets cleared
    const label = document.querySelector('[data-voucherify-discount-label]')!;
    label.textContent = 'OLD LABEL';

    window.fetch = mockFetch(qualificationsResponse());

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    await window.ppLib.voucherify!.fetchPricing();

    expect(label.textContent).toBe('');
  });

  it('discountedPrice never goes below zero', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    // Discount larger than price
    const response = qualificationsResponse([{
      id: 'v1',
      result: { discount: { type: 'AMOUNT', amount_off: 100000 } } // $1000 off $60
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results[0].discountedPrice).toBe(0);
  });
});

// =========================================================================
// 20. CAMPAIGN NAME
// =========================================================================
describe('Campaign Name', () => {
  it('includes campaign name from redeemable', async () => {
    loadWithCommon('voucherify');
    setupDOM();

    const response = qualificationsResponse([{
      id: 'v1',
      campaign: 'Summer Sale 2026',
      result: { discount: { type: 'PERCENT', percent_off: 20 } }
    }]);
    window.fetch = mockFetch(response);

    window.ppLib.voucherify!.configure({
      api: { applicationId: 'app', clientSecretKey: 'key' } as any,
      pricing: { autoFetch: false } as any
    });

    const results = await window.ppLib.voucherify!.fetchPricing();

    expect(results[0].campaignName).toBe('Summer Sale 2026');
  });
});
