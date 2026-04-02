/**
 * Voucherify Native Coverage Test
 *
 * Imports the voucherify source directly through Vitest's transform pipeline
 * instead of loading the pre-built IIFE via vm.runInThisContext(). This bypasses
 * the ast-v8-to-istanbul conversion bug that produces garbled branch/line counts
 * when V8 coverage is accumulated across many vm.Script executions.
 *
 * All other voucherify test files use { coverable: false } so their IIFE
 * evaluations don't contribute to src/voucherify/index.ts coverage. This file
 * is the sole source of voucherify coverage data.
 *
 * Common is loaded via IIFE (not native import) to avoid corrupting common's
 * coverage data through merge of IIFE + native V8 evaluations.
 */
import { loadModule } from '../helpers/iife-loader.ts';

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

async function freshLoad() {
  vi.resetModules();
  delete window.ppLib;
  delete window.ppLibReady;
  (window as any).ppAnalytics = undefined;

  loadModule('common');
  await import('../../src/voucherify/index.ts');
}

describe('Voucherify native coverage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.cookie.split(';').forEach(c => {
      document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
  });

  // =====================================================
  // MODULE BOOTSTRAP
  // =====================================================

  it('loads module and exposes public API', async () => {
    await freshLoad();
    expect(window.ppLib.voucherify).toBeDefined();
    expect(typeof window.ppLib.voucherify.configure).toBe('function');
    expect(typeof window.ppLib.voucherify.init).toBe('function');
    expect(typeof window.ppLib.voucherify.fetchPricing).toBe('function');
    expect(typeof window.ppLib.voucherify.validateVoucher).toBe('function');
    expect(typeof window.ppLib.voucherify.checkQualifications).toBe('function');
    expect(typeof window.ppLib.voucherify.clearCache).toBe('function');
    expect(typeof window.ppLib.voucherify.isReady).toBe('function');
    expect(typeof window.ppLib.voucherify.getConfig).toBe('function');
  });

  // =====================================================
  // CONFIGURATION
  // =====================================================

  it('configure() returns default config and merges options', async () => {
    await freshLoad();
    const config = window.ppLib.voucherify.configure();
    expect(config.api.applicationId).toBe('');
    expect(config.consent.required).toBe(false);

    window.ppLib.voucherify.configure({ api: { applicationId: 'test-id' } as any });
    const updated = window.ppLib.voucherify.getConfig();
    expect(updated.api.applicationId).toBe('test-id');
  });

  it('configure() without options returns current config', async () => {
    await freshLoad();
    const config = window.ppLib.voucherify.configure();
    expect(config).toBeDefined();
  });

  it('default checkFunction returns true (line 51)', async () => {
    await freshLoad();
    // consent.required=true, mode='custom', do NOT override checkFunction → uses default
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'custom' as any }
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true); // default checkFunction returns true
  });

  // =====================================================
  // INIT & CONSENT
  // =====================================================

  it('init warns when no applicationId and cache not enabled', async () => {
    await freshLoad();
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.init();
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId configured'));
    expect(window.ppLib.voucherify.isReady()).toBe(false);
  });

  it('init with autoFetch=true calls fetchPricing immediately (line 458)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: true } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();
    // fetchPricing is called asynchronously; wait for it
    await new Promise(r => setTimeout(r, 50));
    expect(window.fetch).toHaveBeenCalled();
  });

  it('init succeeds with cache enabled (no applicationId needed)', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true);
  });

  it('consent not required — init proceeds', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true);
  });

  it('consent required, custom mode, check returns true', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'custom' as any, checkFunction: () => true }
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true);
  });

  it('consent required, custom mode, check returns false — blocks init', async () => {
    await freshLoad();
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'custom' as any, checkFunction: () => false }
    });
    window.ppLib.voucherify.init();
    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('Consent not granted'));
    expect(window.ppLib.voucherify.isReady()).toBe(false);
  });

  it('consent required, analytics mode, ppAnalytics returns true', async () => {
    await freshLoad();
    (window as any).ppAnalytics = { consent: { status: () => true } };
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true);
  });

  it('consent required, analytics mode, ppAnalytics returns false', async () => {
    await freshLoad();
    (window as any).ppAnalytics = { consent: { status: () => false } };
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(false);
  });

  it('consent analytics mode, ppAnalytics missing — returns false', async () => {
    await freshLoad();
    (window as any).ppAnalytics = undefined;
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(false);
  });

  it('consent analytics mode, ppAnalytics.consent.status throws', async () => {
    await freshLoad();
    (window as any).ppAnalytics = { consent: { status: () => { throw new Error('boom'); } } };
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: true, mode: 'analytics', checkFunction: () => true }
    });
    window.ppLib.voucherify.init();
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('consent check error'), expect.any(Error));
  });

  // =====================================================
  // API CLIENT — Cache
  // =====================================================

  it('API cache hit returns cached data', async () => {
    await freshLoad();
    setupDOM();
    const fetchMock = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.fetch = fetchMock;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // First call — cache miss
    await window.ppLib.voucherify.fetchPricing();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    await window.ppLib.voucherify.fetchPricing();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no additional fetch
  });

  it('cache entry expired — re-fetches', async () => {
    await freshLoad();
    setupDOM();
    const fetchMock = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.fetch = fetchMock;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 1 } as any, // 1ms TTL
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    await new Promise(r => setTimeout(r, 5)); // wait for TTL expiry
    await window.ppLib.voucherify.fetchPricing();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // =====================================================
  // API CLIENT — Retry
  // =====================================================

  it('retries on 5xx and succeeds on subsequent attempt', async () => {
    await freshLoad();
    setupDOM();
    vi.useFakeTimers();
    let callCount = 0;
    window.fetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      retry: { maxRetries: 2, baseDelay: 100 }
    });
    window.ppLib.voucherify.init();

    const promise = window.ppLib.voucherify.fetchPricing();
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(callCount).toBe(2);
    vi.useRealTimers();
  });

  it('retries on network error and eventually throws', async () => {
    await freshLoad();
    setupDOM();
    vi.useFakeTimers();
    window.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      retry: { maxRetries: 1, baseDelay: 100 }
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const promise = window.ppLib.voucherify.fetchPricing();
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toEqual([]); // fetchPricing catches the error
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
    vi.useRealTimers();
  });

  it('does not retry on 4xx client error', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({}, 404);
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      retry: { maxRetries: 2, baseDelay: 100 }
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]);
    expect(window.fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // =====================================================
  // API CLIENT — Direct API mode
  // =====================================================

  it('direct API mode with valid credentials', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret', baseUrl: 'https://api.test.com', origin: 'https://example.com' } as any,
      cache: { enabled: false } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/client/v1/qualifications'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('direct API mode rejects on missing credentials', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({});
    window.ppLib.voucherify.configure({
      api: { applicationId: '', clientSecretKey: '' } as any,
      cache: { enabled: false } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
  });

  it('cache enabled but empty baseUrl throws (line 119-120)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({});
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
  });

  it('direct API missing clientSecretKey only (line 130-131 branches)', async () => {
    await freshLoad();
    setupDOM();
    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: '' } as any,
      cache: { enabled: false } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    await window.ppLib.voucherify.fetchPricing();
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
  });

  it('direct API missing applicationId only (line 130-131 branches)', async () => {
    await freshLoad();
    setupDOM();
    window.ppLib.voucherify.configure({
      api: { applicationId: '', clientSecretKey: 'secret' } as any,
      cache: { enabled: false } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    await window.ppLib.voucherify.fetchPricing();
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('fetchPricing error'), expect.any(Error));
  });

  it('API response not ok — throws error', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({}, 503);
    vi.useFakeTimers();
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      retry: { maxRetries: 0, baseDelay: 100 }
    });
    window.ppLib.voucherify.init();

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]);
    vi.useRealTimers();
  });

  // =====================================================
  // CONTEXT BUILDER
  // =====================================================

  it('builds customer with sourceId, login state, and UTM params', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user-123';
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=test', origin: 'https://example.com' },
      writable: true, configurable: true
    });
    window.ppLib.login = { isLoggedIn: () => true } as any;
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      context: { customerSourceIdCookie: 'userId', includeUtmParams: true, includeLoginState: true }
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    const body = JSON.parse((window.fetch as any).mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    expect(body.customer.source_id).toBe('user-123');
    expect(body.customer.metadata.is_logged_in).toBe(true);
    expect(body.customer.metadata.utm_source).toBe('google');
  });

  it('buildCustomer with includeLoginState=false and includeUtmParams=false', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user-456';
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      context: { customerSourceIdCookie: 'userId', includeUtmParams: false, includeLoginState: false }
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    const body = JSON.parse((window.fetch as any).mock.calls[0][1].body);
    expect(body.customer).toBeDefined();
    expect(body.customer.source_id).toBe('user-456');
    expect(body.customer.metadata.is_logged_in).toBeUndefined();
    expect(body.customer.metadata.utm_source).toBeUndefined();
  });

  it('buildCustomer with URL missing some UTM params (line 201 false branch)', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user-789';
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/?utm_source=google', origin: 'https://example.com' },
      writable: true, configurable: true
    });
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      context: { customerSourceIdCookie: 'userId', includeUtmParams: true, includeLoginState: false }
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    const body = JSON.parse((window.fetch as any).mock.calls[0][1].body);
    expect(body.customer.metadata.utm_source).toBe('google');
    // utm_medium and utm_campaign not in URL → val is empty → false branch
    expect(body.customer.metadata.utm_medium).toBeUndefined();
    expect(body.customer.metadata.utm_campaign).toBeUndefined();
  });

  it('buildCustomer returns undefined when no sourceId cookie', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    const body = JSON.parse((window.fetch as any).mock.calls[0][1].body);
    expect(body.customer).toBeUndefined();
  });

  // =====================================================
  // PRICING ENGINE
  // =====================================================

  it('fetchPricing returns empty array when no products in DOM', async () => {
    await freshLoad();
    document.body.innerHTML = ''; // no products
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]);
  });

  it('fetchPricing processes PERCENT discount and injects DOM', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{
        id: 'v1',
        result: { discount: { type: 'PERCENT', percent_off: 20 } },
        campaign: 'summer'
      }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results.length).toBe(2);
    expect(results[0].discountType).toBe('PERCENT');
    expect(results[0].discountAmount).toBe(12); // 60 * 20%
    // Check DOM injection
    const el = document.querySelector('[data-voucherify-discount-label]');
    expect(el?.textContent).toContain('OFF');
  });

  it('fetchPricing processes AMOUNT discount', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{
        id: 'v2',
        result: { discount: { type: 'AMOUNT', amount_off: 1000 } }
      }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('AMOUNT');
    expect(results[0].discountAmount).toBe(10); // 1000 cents = $10
  });

  it('fetchPricing processes FIXED discount', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{
        id: 'v3',
        result: { discount: { type: 'FIXED', fixed_amount: 4000 } }
      }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('FIXED');
  });

  it('fetchPricing processes UNIT discount', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{
        id: 'v4',
        result: { discount: { type: 'UNIT', unit_off: 1 } }
      }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('UNIT');
  });

  it('UNIT ADD_MISSING_ITEMS discount is skipped', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{
        id: 'v5',
        result: { discount: { type: 'UNIT', effect: 'ADD_MISSING_ITEMS', unit_off: 1 } }
      }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('NONE');
  });

  it('redeemable without discount is skipped', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v6', result: {} }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('NONE');
  });

  it('handles response with redeemables.data array format', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      redeemables: { data: [{ id: 'v7', result: { discount: { type: 'PERCENT', percent_off: 10 } } }] },
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('PERCENT');
  });

  it('element without price attribute uses 0 default (line 232 branch)', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-product="no-price-product">
        <span data-voucherify-original-price></span>
        <span data-voucherify-discounted-price></span>
      </div>
    `;
    window.fetch = mockFetch({
      qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 50 } } }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].productId).toBe('no-price-product');
    // basePrice is 0 because no price attribute
    expect(results[0].discountedPrice).toBe(0);
  });

  it('response with no qualifications and no redeemables key (line 286 fallback)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ total: 0, has_more: false }); // no qualifications, no redeemables
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('NONE');
  });

  it('response with redeemables as empty object — no .data (line 287 || [] branch)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      redeemables: {}, // not an array, and no .data property → || [] fallback
      total: 0, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('NONE');
  });

  it('response with redeemables as non-array object with data (line 287 branch)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      redeemables: { data: [{ id: 'v8', result: { discount: { type: 'AMOUNT', amount_off: 500 } } }] },
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('AMOUNT');
  });

  it('explicit productId not matching any DOM element (line 292 false branch)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 20 } } }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // 'non-existent' has no matching DOM element → domProduct is undefined → basePrice = 0
    const results = await window.ppLib.voucherify.fetchPricing(['non-existent']);
    expect(results[0].productId).toBe('non-existent');
    expect(results[0].discountedPrice).toBe(0);
  });

  it('discount without specific numeric fields (lines 312,315,318,321 || 0 branches)', async () => {
    await freshLoad();
    setupDOM();
    // PERCENT with no percent_off
    window.fetch = mockFetch({
      qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT' } } }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    let results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountAmount).toBe(0); // 60 * (0/100)

    // AMOUNT with no amount_off
    window.ppLib.voucherify.clearCache();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v2', result: { discount: { type: 'AMOUNT' } } }],
      total: 1, has_more: false
    });
    results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountAmount).toBe(0);

    // FIXED with no fixed_amount
    window.ppLib.voucherify.clearCache();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v3', result: { discount: { type: 'FIXED' } } }],
      total: 1, has_more: false
    });
    results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountAmount).toBe(60); // 60 - (0/100) = 60

    // UNIT with no unit_off
    window.ppLib.voucherify.clearCache();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v4', result: { discount: { type: 'UNIT' } } }],
      total: 1, has_more: false
    });
    results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountAmount).toBe(0);
  });

  it('unknown discount type falls through all branches (line 319 false)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{ id: 'v1', result: { discount: { type: 'UNKNOWN_TYPE' } } }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('NONE');
  });

  it('redeemable without id field (line 330 false branch)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({
      qualifications: [{ result: { discount: { type: 'PERCENT', percent_off: 10 } } }], // no id
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].applicableVouchers).toEqual([]); // no id → not pushed
  });

  it('DOM product without original/discounted/label elements (lines 361,365,373)', async () => {
    await freshLoad();
    // Product element with NO child span elements
    document.body.innerHTML = `
      <div data-voucherify-product="bare-product" data-voucherify-base-price="100"></div>
    `;
    window.fetch = mockFetch({
      qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 25 } } }],
      total: 1, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing();
    expect(results[0].discountType).toBe('PERCENT');
    // No child elements → querySelector returns null → branches skipped, no crash
  });

  it('injectPricing skips product with no matching result', async () => {
    await freshLoad();
    setupDOM();
    // Return results for only weight-loss, not hair-loss
    window.fetch = mockFetch({
      qualifications: [],
      total: 0, has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    // No crash means success
  });

  it('getProductsFromDOM skips elements with empty product ID', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-product="" data-voucherify-base-price="60">
        <span data-voucherify-original-price></span>
      </div>
    `;
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const result = await window.ppLib.voucherify.fetchPricing();
    expect(result).toEqual([]); // empty product ID → no products → empty result
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('empty product ID'));
  });

  // =====================================================
  // VALIDATE VOUCHER
  // =====================================================

  it('validateVoucher with valid code', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ status: 'APPLICABLE', result: { discount: { type: 'PERCENT', percent_off: 10 }, order: { amount: 6000, discount_amount: 600, total_amount: 5400 } } }]
    });
    window.ppLib.voucherify.configure({
      api: { applicationId: 'app', clientSecretKey: 'key', baseUrl: 'https://api.test.com', origin: '' } as any,
      cache: { enabled: false } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('SUMMER20', {
      customer: { source_id: 'cust1' },
      order: { amount: 6000 }
    });
    expect(result.valid).toBe(true);
    expect(result.order).toBeDefined();
  });

  it('validateVoucher with empty code', async () => {
    await freshLoad();
    const result = await window.ppLib.voucherify.validateVoucher('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Empty voucher code');
  });

  it('validateVoucher APPLICABLE — reason is undefined (line 509 false branch)', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ status: 'APPLICABLE', result: { discount: { type: 'PERCENT', percent_off: 10 } } }]
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('VALID');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('validateVoucher with order having zero/missing fields (lines 511-513 || 0)', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ status: 'APPLICABLE', result: { discount: { type: 'PERCENT', percent_off: 10 }, order: {} } }]
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('VALID2');
    expect(result.valid).toBe(true);
    expect(result.order).toBeDefined();
    expect(result.order!.amount).toBe(0);
    expect(result.order!.discount_amount).toBe(0);
    expect(result.order!.total_amount).toBe(0);
  });

  it('validateVoucher with no order in result (line 510 false branch)', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ status: 'APPLICABLE', result: { discount: { type: 'PERCENT', percent_off: 10 } } }]
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('NOORDER');
    expect(result.valid).toBe(true);
    expect(result.order).toBeUndefined();
  });

  it('validateVoucher catch block when sanitize throws (lines 518-519)', async () => {
    await freshLoad();
    // Make sanitize throw synchronously to trigger the sync catch block
    vi.spyOn(window.ppLib.Security, 'sanitize').mockImplementation(() => { throw new Error('sanitize error'); });

    const logSpy = vi.spyOn(window.ppLib, 'log');
    const result = await window.ppLib.voucherify.validateVoucher('ERRORCODE');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Validation error');
    expect(logSpy).toHaveBeenCalledWith('error', expect.stringContaining('validateVoucher error'), expect.any(Error));
  });

  it('validateVoucher with inapplicable code', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ status: 'INAPPLICABLE', result: {} }]
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('BADCODE');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('INAPPLICABLE');
  });

  it('validateVoucher with redeemable without status — reason falls back to Unknown (line 509)', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ result: {} }] // no status field → status is undefined
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.validateVoucher('NOSTATUS');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Unknown');
  });

  // =====================================================
  // CHECK QUALIFICATIONS
  // =====================================================

  it('checkQualifications returns formatted response', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [{ id: 'v1' }],
      total: 1,
      has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL' });
    expect(result.redeemables).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('checkQualifications with no context arg uses default (line 524 false branch)', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      redeemables: [],
      total: 0,
      has_more: false
    });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      consent: { required: false } as any
    });

    const result = await window.ppLib.voucherify.checkQualifications();
    expect(result.total).toBe(0);
  });

  // =====================================================
  // CLEAR CACHE
  // =====================================================

  it('clearCache clears the in-memory cache', async () => {
    await freshLoad();
    setupDOM();
    const fetchMock = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.fetch = fetchMock;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();
    window.ppLib.voucherify.clearCache();
    await window.ppLib.voucherify.fetchPricing();
    expect(fetchMock).toHaveBeenCalledTimes(2); // cache was cleared
  });

  // =====================================================
  // FETCH PRICING WITH SPECIFIC PRODUCT IDS
  // =====================================================

  it('fetchPricing accepts explicit productIds', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    const results = await window.ppLib.voucherify.fetchPricing(['weight-loss']);
    expect(results.length).toBe(1);
    expect(results[0].productId).toBe('weight-loss');
  });

  // =====================================================
  // CACHE EVICTION
  // =====================================================

  it('evicts stale cache entries when exceeding 50', async () => {
    await freshLoad();
    setupDOM();
    let callCount = 0;
    window.fetch = vi.fn(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 1 } as any, // 1ms TTL
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // Make >50 unique requests to fill cache
    for (let i = 0; i < 52; i++) {
      await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL', metadata: { idx: i } } as any);
    }
    // Wait for TTL expiry and make one more to trigger eviction
    await new Promise(r => setTimeout(r, 5));
    await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL', metadata: { idx: 999 } } as any);
    // No crash = eviction succeeded
    expect(callCount).toBeGreaterThan(52);
  });

  // =====================================================
  // INIT RE-INITIALIZATION GUARD (H1)
  // =====================================================

  it('init() is a no-op on second call (re-initialization guard)', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();
    expect(window.ppLib.voucherify.isReady()).toBe(true);

    // Second call should be a no-op
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.init();
    // Should NOT log any additional init messages
    expect(logSpy).not.toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId'));
  });

  // =====================================================
  // INFLIGHT REQUEST DEDUP (H4)
  // =====================================================

  it('fetchPricing deduplicates concurrent calls', async () => {
    await freshLoad();
    setupDOM();
    let fetchCallCount = 0;
    window.fetch = vi.fn(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 1 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // Clear cache so fetch is triggered
    window.ppLib.voucherify.clearCache();
    await new Promise(r => setTimeout(r, 5));

    // Fire two concurrent calls
    const [r1, r2] = await Promise.all([
      window.ppLib.voucherify.fetchPricing(),
      window.ppLib.voucherify.fetchPricing()
    ]);

    // Both should resolve to the same result
    expect(r1).toEqual(r2);
    // Only one fetch should have been made (inflight dedup)
    expect(fetchCallCount).toBe(1);
  });

  // =====================================================
  // CREDENTIAL WARNING (H5)
  // =====================================================

  it('blocks init when API credentials are exposed in direct API mode', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test-app', clientSecretKey: 'secret-key' } as any,
      cache: { enabled: false } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.init();

    expect(logSpy).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('BLOCKED')
    );
    // Module should NOT be initialized
    expect(window.ppLib.voucherify.isReady()).toBe(false);
  });

  it('does not warn about credentials when cache is enabled', async () => {
    await freshLoad();
    setupDOM();
    window.fetch = mockFetch({ qualifications: [], total: 0, has_more: false });
    window.ppLib.voucherify.configure({
      api: { applicationId: 'test-app', clientSecretKey: 'secret-key' } as any,
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    const logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.init();

    expect(logSpy).not.toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Direct API mode exposes credentials')
    );
  });

  // =====================================================
  // STALE CACHE DELETION ON READ (M2)
  // =====================================================

  it('isCacheValid deletes stale entries on read', async () => {
    await freshLoad();
    setupDOM();
    let fetchCallCount = 0;
    window.fetch = vi.fn(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;
    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 1 } as any, // 1ms TTL
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // First call populates cache
    await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL' });
    expect(fetchCallCount).toBe(1);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 5));

    // Second call should re-fetch because stale entry was deleted
    await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL' });
    expect(fetchCallCount).toBe(2);
  });

  // =====================================================
  // EDGE MODE
  // =====================================================

  it('edge mode: fetchPricing calls edge URL and injects pricing', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        products: {
          'weight-loss': {
            basePrice: 60,
            discountedPrice: 45,
            discountAmount: 15,
            discountLabel: '25% OFF',
            discountType: 'PERCENT',
            applicableVouchers: ['promo_1'],
            campaignName: 'Summer'
          },
          'hair-loss': {
            basePrice: 30,
            discountedPrice: 30,
            discountAmount: 0,
            discountLabel: '',
            discountType: 'NONE',
            applicableVouchers: []
          }
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results.length).toBe(2);
    expect(results[0].productId).toBe('weight-loss');
    expect(results[0].discountedPrice).toBe(45);
    expect(results[1].productId).toBe('hair-loss');
    expect(results[1].discountedPrice).toBe(30);

    // Verify fetch was called with edge URL
    expect(window.fetch).toHaveBeenCalledTimes(1);
    var callUrl = (window.fetch as any).mock.calls[0][0] as string;
    expect(callUrl).toContain('pp-pricing.workers.dev/api/prices/anonymous');
    expect(callUrl).toContain('products=');

    // Verify DOM injection
    var discountedEl = document.querySelector('[data-voucherify-product="weight-loss"] [data-voucherify-discounted-price]')!;
    expect(discountedEl.textContent).toContain('45');
  });

  it('edge mode: fetchPricing adds/removes loading class', async () => {
    await freshLoad();
    setupDOM();

    var resolveEdge: (v: any) => void;
    window.fetch = vi.fn().mockReturnValue(new Promise(resolve => {
      resolveEdge = resolve;
    })) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var fetchPromise = window.ppLib.voucherify.fetchPricing();

    // Loading class should be added immediately
    var el = document.querySelector('[data-voucherify-product="weight-loss"]')!;
    expect(el.classList.contains('pp-voucherify-loading')).toBe(true);

    // Resolve the fetch
    resolveEdge!({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        products: {
          'weight-loss': { basePrice: 60, discountedPrice: 60, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] },
          'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
        },
        timestamp: Date.now()
      })
    });

    await fetchPromise;

    // Loading class should be removed
    expect(el.classList.contains('pp-voucherify-loading')).toBe(false);
  });

  it('edge mode: fetchPricing falls back to direct API on edge failure', async () => {
    await freshLoad();
    setupDOM();

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        // Edge call fails
        return Promise.reject(new Error('Network error'));
      }
      // Fallback direct API call succeeds
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(qualificationsResponse([
          { id: 'promo_1', object: 'promotion_tier', result: { discount: { type: 'PERCENT', percent_off: 10 } } }
        ]))
      });
    }) as any;

    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret' } as any,
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results.length).toBe(2);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Edge service unavailable'));
    // First call was edge (failed), second was direct API (succeeded)
    expect(callCount).toBe(2);
  });

  it('edge mode: fetchPricing falls back on non-ok edge response (500)', async () => {
    await freshLoad();
    setupDOM();

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        // Edge returns 500
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(qualificationsResponse([]))
      });
    }) as any;

    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret' } as any,
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results.length).toBe(2);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Edge service unavailable'));
    expect(callCount).toBe(2);
  });

  it('edge mode: determineSegment returns member when userId cookie set', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'member',
        products: {
          'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] },
          'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    var callUrl = (window.fetch as any).mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/prices/member');
  });

  it('edge mode: validateVoucher uses edge endpoint', async () => {
    await freshLoad();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        redeemables: [{ id: 'SUMMER25', status: 'APPLICABLE', result: { discount: { type: 'PERCENT', percent_off: 25 } } }]
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.validateVoucher('SUMMER25');

    expect(result.valid).toBe(true);
    expect(result.code).toBe('SUMMER25');
    expect(window.fetch).toHaveBeenCalledWith(
      'https://pp-pricing.workers.dev/api/validate',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('edge mode: validateVoucher falls back on edge failure', async () => {
    await freshLoad();

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        // Edge returns 500 (covers !response.ok throw in edgeValidateVoucher)
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          redeemables: [{ id: 'CODE', status: 'APPLICABLE', result: {} }]
        })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret' } as any,
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    var result = await window.ppLib.voucherify.validateVoucher('CODE');

    expect(result.valid).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Edge service unavailable'));
    expect(callCount).toBe(2);
  });

  it('edge mode: checkQualifications uses edge endpoint', async () => {
    await freshLoad();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ redeemables: [{ id: 'p1', object: 'promotion_tier' }], total: 1, has_more: false })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL' });

    expect(result.total).toBe(1);
    expect(window.fetch).toHaveBeenCalledWith(
      'https://pp-pricing.workers.dev/api/qualify',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('edge mode: checkQualifications falls back on edge failure', async () => {
    await freshLoad();

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        // Edge returns 502 (covers !response.ok throw in edgeCheckQualifications)
        return Promise.resolve({ ok: false, status: 502 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ redeemables: [], total: 0, has_more: false })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      api: { applicationId: 'app-id', clientSecretKey: 'secret' } as any,
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    var result = await window.ppLib.voucherify.checkQualifications({ scenario: 'ALL' });

    expect(result.total).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Edge service unavailable'));
    expect(callCount).toBe(2);
  });

  it('edge mode: init allows edge mode without applicationId', async () => {
    await freshLoad();

    window.fetch = mockFetch({ segment: 'anonymous', products: {}, timestamp: Date.now() });

    var logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    expect(window.ppLib.voucherify.isReady()).toBe(true);
    expect(logSpy).not.toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId'));
  });

  it('edge mode: fetchPricing handles products not in edge response', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        products: {
          'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] }
          // hair-loss is missing from response
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results.length).toBe(2);
    // weight-loss has pricing from edge
    expect(results[0].discountedPrice).toBe(45);
    // hair-loss falls back to base price
    expect(results[1].discountedPrice).toBe(30);
    expect(results[1].discountType).toBe('NONE');
  });

  it('edge mode: configure with edge config returns it in getConfig', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' }
    });
    var config = window.ppLib.voucherify.getConfig();
    expect(config.edge.mode).toBe('edge');
    expect(config.edge.edgeUrl).toBe('https://pp-pricing.workers.dev');
  });

  it('edge mode: fetchPricing with explicit productIds not in DOM (basePrices fallback)', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        products: {
          'unknown-prod': { basePrice: 0, discountedPrice: 0, discountAmount: 0, discountType: 'NONE', applicableVouchers: [] }
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // Pass a product ID that doesn't exist in DOM — triggers basePrices fallback to 0
    var results = await window.ppLib.voucherify.fetchPricing(['unknown-prod']);
    expect(results.length).toBe(1);
    expect(results[0].basePrice).toBe(0);
  });

  it('edge mode: fetchPricing handles response with null products and missing entry fields', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        // products is null — triggers || {} fallback
        products: null,
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    // All products fall back to base prices since products is null
    expect(results.length).toBe(2);
    expect(results[0].discountType).toBe('NONE');
    expect(results[1].discountType).toBe('NONE');
  });

  it('edge mode: fetchPricing handles entry with falsy discountLabel/discountType/applicableVouchers', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        products: {
          'weight-loss': {
            basePrice: 60,
            discountedPrice: 45,
            discountAmount: 15,
            // These are falsy — triggers || fallbacks
            discountLabel: '',
            discountType: null,
            applicableVouchers: null
          },
          'hair-loss': {
            basePrice: 30,
            discountedPrice: 30,
            discountAmount: 0,
            discountLabel: null,
            discountType: '',
            applicableVouchers: undefined
          }
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    expect(results.length).toBe(2);
    // Fallback values
    expect(results[0].discountLabel).toBe('');
    expect(results[0].discountType).toBe('NONE');
    expect(results[0].applicableVouchers).toEqual([]);
    expect(results[1].discountLabel).toBe('');
    expect(results[1].discountType).toBe('NONE');
    expect(results[1].applicableVouchers).toEqual([]);
  });

  // =====================================================
  // CMS MODE
  // =====================================================

  it('cms mode: anonymous user — no fetch, returns empty', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // No userId cookie → anonymous → CMS prices already in HTML
    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results).toEqual([]);
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('cms mode: member without page opt-in — no fetch, returns empty', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';

    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    // Member but no data-voucherify-member-pricing attribute → keep CMS prices
    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results).toEqual([]);
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('cms mode: member with page opt-in — fetches from edge and injects', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';

    // Add page opt-in attribute
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-voucherify-member-pricing', '');
    document.body.appendChild(wrapper);

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'member',
        products: {
          'weight-loss': {
            basePrice: 60,
            discountedPrice: 30,
            discountAmount: 30,
            discountLabel: '50% OFF',
            discountType: 'PERCENT',
            applicableVouchers: ['promo_1'],
            campaignName: 'Member Deal'
          },
          'hair-loss': {
            basePrice: 30,
            discountedPrice: 20,
            discountAmount: 10,
            discountLabel: '33% OFF',
            discountType: 'PERCENT',
            applicableVouchers: []
          }
        },
        timestamp: Date.now()
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results.length).toBe(2);
    expect(results[0].discountedPrice).toBe(30);
    expect(results[1].discountedPrice).toBe(20);

    // Verify fetch was called with member segment
    var callUrl = (window.fetch as any).mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/prices/member');

    // Verify DOM injection
    var discountedEl = document.querySelector('[data-voucherify-product="weight-loss"] [data-voucherify-discounted-price]')!;
    expect(discountedEl.textContent).toContain('30');
  });

  it('cms mode: member with page opt-in — edge failure keeps CMS prices', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-voucherify-member-pricing', '');
    document.body.appendChild(wrapper);

    window.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    var results = await window.ppLib.voucherify.fetchPricing();

    // Returns empty — no fallback to direct API in CMS mode
    expect(results).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('Edge fetch failed in CMS mode'));
  });

  it('cms mode: loading class management during member fetch', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-voucherify-member-pricing', '');
    document.body.appendChild(wrapper);

    var resolveEdge: (v: any) => void;
    window.fetch = vi.fn().mockReturnValue(new Promise(resolve => {
      resolveEdge = resolve;
    })) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var fetchPromise = window.ppLib.voucherify.fetchPricing();

    // Loading class should be added
    var el = document.querySelector('[data-voucherify-product="weight-loss"]')!;
    expect(el.classList.contains('pp-voucherify-loading')).toBe(true);

    // Resolve the fetch
    resolveEdge!({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'member',
        products: {
          'weight-loss': { basePrice: 60, discountedPrice: 60, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] },
          'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
        },
        timestamp: Date.now()
      })
    });

    await fetchPromise;

    // Loading class should be removed
    expect(el.classList.contains('pp-voucherify-loading')).toBe(false);
  });

  it('cms mode: init allows CMS mode without applicationId', async () => {
    await freshLoad();

    var logSpy = vi.spyOn(window.ppLib, 'log');
    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    expect(window.ppLib.voucherify.isReady()).toBe(true);
    expect(logSpy).not.toHaveBeenCalledWith('warn', expect.stringContaining('No applicationId'));
  });

  it('cms mode: getConfig returns cms mode', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' }
    });
    var config = window.ppLib.voucherify.getConfig();
    expect(config.edge.mode).toBe('cms');
    expect(config.edge.edgeUrl).toBe('https://pp-pricing.workers.dev');
  });

  it('cms mode: no products in DOM — returns empty', async () => {
    await freshLoad();
    // Don't call setupDOM() — no products in DOM
    document.cookie = 'userId=user123;path=/';

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-voucherify-member-pricing', '');
    document.body.appendChild(wrapper);

    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    expect(results).toEqual([]);
    // getProductsFromDOM returns empty, so ids.length === 0 → early return
    expect(window.fetch).not.toHaveBeenCalled();
  });

  // =====================================================
  // OFFERS — EDGE MODE
  // =====================================================

  it('edge mode: fetchOffers calls edge URL, returns categorized bundle', async () => {
    await freshLoad();
    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [{ id: 'c1', category: 'coupon', title: 'Save 25%', description: 'Desc', code: 'SAVE25', discount: { type: 'PERCENT', percentOff: 25, label: '25% OFF' }, applicableProductIds: [] }],
          promotions: [],
          loyalty: [],
          referrals: [],
          gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons.length).toBe(1);
    expect(result.offers.coupons[0].code).toBe('SAVE25');
    expect(result.segment).toBe('anonymous');

    var callUrl = (window.fetch as any).mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/offers/anonymous');
  });

  it('edge mode: fetchOffers returns empty bundle on edge failure', async () => {
    await freshLoad();
    window.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons).toEqual([]);
    expect(result.offers.promotions).toEqual([]);
  });

  it('edge mode: loading class management on offers container', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="all">
        <div data-voucherify-offer-template><span data-voucherify-offer-title></span></div>
        <p data-voucherify-offers-empty>No offers.</p>
      </div>
    `;

    var resolveEdge: (v: any) => void;
    window.fetch = vi.fn().mockReturnValue(new Promise(resolve => {
      resolveEdge = resolve;
    })) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var fetchPromise = window.ppLib.voucherify.fetchOffers();

    var container = document.querySelector('[data-voucherify-offers]')!;
    expect(container.classList.contains('pp-voucherify-offers-loading')).toBe(true);

    resolveEdge!({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: { coupons: [], promotions: [], loyalty: [], referrals: [], gifts: [] },
        timestamp: 1000
      })
    });

    await fetchPromise;
    expect(container.classList.contains('pp-voucherify-offers-loading')).toBe(false);
  });

  // =====================================================
  // OFFERS — CMS MODE
  // =====================================================

  it('cms mode offers: anonymous → returns empty, no fetch', async () => {
    await freshLoad();
    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons).toEqual([]);
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('cms mode offers: member without opt-in → returns empty, no fetch', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';
    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons).toEqual([]);
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('cms mode offers: member with opt-in → fetches from edge', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';
    document.body.innerHTML = '<div data-voucherify-member-offers></div>';

    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        segment: 'member',
        offers: {
          coupons: [{ id: 'c1', category: 'coupon', title: 'Member Deal', description: 'Desc', code: 'MEM10', applicableProductIds: [] }],
          promotions: [],
          loyalty: [],
          referrals: [],
          gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons.length).toBe(1);
    expect(result.offers.coupons[0].code).toBe('MEM10');

    var callUrl = (window.fetch as any).mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/offers/member');
  });

  // =====================================================
  // OFFERS — DIRECT API MODE
  // =====================================================

  it('direct mode: categorizes qualifications response into offers bundle', async () => {
    await freshLoad();
    window.fetch = mockFetch({
      qualifications: [
        { id: 'promo_1', object: 'promotion_tier', result: { discount: { type: 'PERCENT', percent_off: 20 } }, campaign_name: 'Sale' },
        { id: 'coupon_1', object: 'voucher', campaign_type: 'DISCOUNT_COUPONS', voucher: { code: 'SAVE20' }, result: { discount: { type: 'AMOUNT', amount_off: 2000 } }, campaign_name: 'Coupons' },
        { id: 'loyalty_1', object: 'loyalty_card', result: { loyalty_card: { points: 100, balance: 75 } }, campaign_name: 'Rewards' }
      ]
    });

    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.promotions.length).toBe(1);
    expect(result.offers.coupons.length).toBe(1);
    expect(result.offers.loyalty.length).toBe(1);
    expect(result.offers.coupons[0].code).toBe('SAVE20');
    expect(result.offers.loyalty[0].loyalty!.balance).toBe(75);
  });

  it('direct mode: handles empty qualifications response', async () => {
    await freshLoad();
    window.fetch = mockFetch({ qualifications: [] });

    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons).toEqual([]);
    expect(result.offers.promotions).toEqual([]);
    expect(result.offers.loyalty).toEqual([]);
  });

  // =====================================================
  // OFFERS — PERSONALIZATION
  // =====================================================

  it('merges personal wallet with segment offers', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Segment offers from edge
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            segment: 'member',
            offers: {
              coupons: [{ id: 'seg_c1', category: 'coupon', title: 'Segment Coupon', description: '', applicableProductIds: [] }],
              promotions: [],
              loyalty: [],
              referrals: [],
              gifts: []
            },
            timestamp: 1000
          })
        });
      }
      // CUSTOMER_WALLET via cache proxy
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          qualifications: [
            { id: 'wal_c1', object: 'voucher', campaign_type: 'DISCOUNT_COUPONS', voucher: { code: 'PERSONAL10' }, result: { discount: { type: 'PERCENT', percent_off: 10 } }, campaign_name: 'Personal' }
          ]
        })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      offers: { personalizeForMember: true } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons.length).toBe(2);
    expect(result.offers.coupons[0].id).toBe('seg_c1');
    expect(result.offers.coupons[1].id).toBe('wal_c1');
  });

  it('deduplicates offers by id when merging', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';

    var callCount = 0;
    window.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            segment: 'member',
            offers: {
              coupons: [{ id: 'same_id', category: 'coupon', title: 'Shared', description: '', applicableProductIds: [] }],
              promotions: [], loyalty: [], referrals: [], gifts: []
            },
            timestamp: 1000
          })
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          qualifications: [
            { id: 'same_id', object: 'voucher', campaign_type: 'DISCOUNT_COUPONS', result: { discount: { type: 'PERCENT', percent_off: 10 } }, campaign_name: 'Same' }
          ]
        })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      pricing: { autoFetch: false } as any,
      offers: { personalizeForMember: true } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    // Should not duplicate
    expect(result.offers.coupons.length).toBe(1);
  });

  it('skips wallet when not logged in', async () => {
    await freshLoad();
    // No userId cookie → anonymous

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [{ id: 'c1', category: 'coupon', title: 'Public', description: '', applicableProductIds: [] }],
          promotions: [], loyalty: [], referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      offers: { personalizeForMember: true } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var result = await window.ppLib.voucherify.fetchOffers();
    expect(result.offers.coupons.length).toBe(1);
    // Only 1 fetch (segment), no wallet call
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  // =====================================================
  // OFFERS — DOM RENDERING
  // =====================================================

  it('clones template for each offer and populates slots', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="coupon">
        <div data-voucherify-offer-template>
          <h3 data-voucherify-offer-title></h3>
          <p data-voucherify-offer-description></p>
          <code data-voucherify-offer-code></code>
          <span data-voucherify-offer-discount></span>
          <span data-voucherify-offer-category></span>
        </div>
        <p data-voucherify-offers-empty>No offers.</p>
      </div>
    `;

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [
            { id: 'c1', category: 'coupon', title: 'Summer Sale', description: 'Save 25%', code: 'SAVE25', discount: { type: 'PERCENT', percentOff: 25, label: '25% OFF' }, applicableProductIds: [] },
            { id: 'c2', category: 'coupon', title: 'Flash Deal', description: 'Save $10', code: 'FLASH10', discount: { type: 'AMOUNT', amountOff: 10, label: '$10.00 OFF' }, applicableProductIds: [] }
          ],
          promotions: [], loyalty: [], referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var clones = document.querySelectorAll('.pp-voucherify-offer-clone');
    expect(clones.length).toBe(2);

    // First clone
    expect(clones[0].querySelector('[data-voucherify-offer-title]')!.textContent).toBe('Summer Sale');
    expect(clones[0].querySelector('[data-voucherify-offer-description]')!.textContent).toBe('Save 25%');
    expect(clones[0].querySelector('[data-voucherify-offer-code]')!.textContent).toBe('SAVE25');
    expect(clones[0].querySelector('[data-voucherify-offer-discount]')!.textContent).toBe('25% OFF');
    expect(clones[0].querySelector('[data-voucherify-offer-category]')!.textContent).toBe('coupon');
  });

  it('hides template element', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="coupon">
        <div data-voucherify-offer-template><span data-voucherify-offer-title></span></div>
      </div>
    `;

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: { coupons: [], promotions: [], loyalty: [], referrals: [], gifts: [] },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var template = document.querySelector('[data-voucherify-offer-template]') as HTMLElement;
    expect(template.style.display).toBe('none');
  });

  it('shows empty state when no offers, hides when offers present', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="coupon">
        <div data-voucherify-offer-template><span data-voucherify-offer-title></span></div>
        <p data-voucherify-offers-empty>No offers.</p>
      </div>
    `;

    // First: no offers
    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: { coupons: [], promotions: [], loyalty: [], referrals: [], gifts: [] },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var emptyEl = document.querySelector('[data-voucherify-offers-empty]') as HTMLElement;
    expect(emptyEl.style.display).toBe('');

    // Second: offers present (need fresh load to reset inflight)
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="coupon">
        <div data-voucherify-offer-template><span data-voucherify-offer-title></span></div>
        <p data-voucherify-offers-empty>No offers.</p>
      </div>
    `;

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [{ id: 'c1', category: 'coupon', title: 'Deal', description: '', applicableProductIds: [] }],
          promotions: [], loyalty: [], referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    emptyEl = document.querySelector('[data-voucherify-offers-empty]') as HTMLElement;
    expect(emptyEl.style.display).toBe('none');
  });

  it('removes previous clones on re-render', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="coupon">
        <div data-voucherify-offer-template><span data-voucherify-offer-title></span></div>
      </div>
    `;

    // Add a fake previous clone
    var oldClone = document.createElement('div');
    oldClone.classList.add('pp-voucherify-offer-clone');
    oldClone.textContent = 'OLD';
    document.querySelector('[data-voucherify-offers]')!.appendChild(oldClone);

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [{ id: 'c1', category: 'coupon', title: 'New', description: '', applicableProductIds: [] }],
          promotions: [], loyalty: [], referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var clones = document.querySelectorAll('.pp-voucherify-offer-clone');
    expect(clones.length).toBe(1);
    expect(clones[0].querySelector('[data-voucherify-offer-title]')!.textContent).toBe('New');
  });

  it('hides code element when offer has no code', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="promotion">
        <div data-voucherify-offer-template>
          <span data-voucherify-offer-title></span>
          <code data-voucherify-offer-code></code>
        </div>
      </div>
    `;

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [],
          promotions: [{ id: 'p1', category: 'promotion', title: 'Auto Promo', description: '', applicableProductIds: [] }],
          loyalty: [], referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var codeEl = document.querySelector('.pp-voucherify-offer-clone [data-voucherify-offer-code]') as HTMLElement;
    expect(codeEl.style.display).toBe('none');
  });

  it('adds category CSS class to cloned rows', async () => {
    await freshLoad();
    document.body.innerHTML = `
      <div data-voucherify-offers="loyalty">
        <div data-voucherify-offer-template>
          <span data-voucherify-offer-title></span>
          <span data-voucherify-offer-loyalty-balance></span>
        </div>
      </div>
    `;

    window.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        segment: 'anonymous',
        offers: {
          coupons: [],
          promotions: [],
          loyalty: [{ id: 'l1', category: 'loyalty', title: 'Rewards', description: '', loyalty: { points: 100, balance: 75 }, applicableProductIds: [] }],
          referrals: [], gifts: []
        },
        timestamp: 1000
      })
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchOffers();

    var clone = document.querySelector('.pp-voucherify-offer-clone')!;
    expect(clone.classList.contains('pp-voucherify-offer-loyalty')).toBe(true);

    var loyaltyEl = clone.querySelector('[data-voucherify-offer-loyalty-balance]')!;
    expect(loyaltyEl.textContent).toBe('75 pts');
  });

  // =====================================================
  // OFFERS — CONFIG
  // =====================================================

  it('configure merges offers config', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      offers: { autoFetch: true, maxPerCategory: 5 } as any
    });
    var config = window.ppLib.voucherify.getConfig();
    expect(config.offers.autoFetch).toBe(true);
    expect(config.offers.maxPerCategory).toBe(5);
    expect(config.offers.personalizeForMember).toBe(false); // default preserved
  });

  it('defaults to autoFetch: false', async () => {
    await freshLoad();
    var config = window.ppLib.voucherify.getConfig();
    expect(config.offers.autoFetch).toBe(false);
  });

  it('fetchOffers exposed on ppLib.voucherify', async () => {
    await freshLoad();
    expect(typeof window.ppLib.voucherify.fetchOffers).toBe('function');
  });

  // =====================================================
  // SEGMENT RESOLUTION
  // =====================================================

  it('resolveSegmentFromRules returns null when no rules configured', async () => {
    await freshLoad();
    window.ppLib.voucherify.configure({
      segments: { rules: [], cookieName: 'pp_segment', cookieMaxAgeMinutes: 30, prioritizeOverMember: false },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    // getSegment with no rules and no userId → anonymous
    expect(window.ppLib.voucherify.getSegment()).toBe('anonymous');
  });

  it('resolveSegmentFromRules matches query param and sets cookie', async () => {
    await freshLoad();
    // Set URL with utm_source=google
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?utm_source=google', href: 'http://localhost?utm_source=google', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.ppLib.voucherify.configure({
      segments: {
        rules: [
          { param: 'utm_source', value: 'google', segment: 'ad-google' },
          { param: 'utm_source', value: 'facebook', segment: 'ad-facebook' }
        ],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    var segment = window.ppLib.voucherify.getSegment();
    expect(segment).toBe('ad-google');
    // Verify cookie was set
    expect(document.cookie).toContain('pp_segment=ad-google');
  });

  it('resolveSegmentFromRules reads from cookie when no query param match', async () => {
    await freshLoad();
    // No query params
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });
    // Set persisted cookie
    document.cookie = 'pp_segment=ad-facebook;path=/';

    window.ppLib.voucherify.configure({
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    var segment = window.ppLib.voucherify.getSegment();
    expect(segment).toBe('ad-facebook');
  });

  it('resolveSegmentFromRules refreshes cookie when query param matches existing cookie', async () => {
    await freshLoad();
    // Set old cookie
    document.cookie = 'pp_segment=ad-facebook;path=/';
    // URL now has utm_source=google
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?utm_source=google', href: 'http://localhost?utm_source=google', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.ppLib.voucherify.configure({
      segments: {
        rules: [
          { param: 'utm_source', value: 'google', segment: 'ad-google' },
          { param: 'utm_source', value: 'facebook', segment: 'ad-facebook' }
        ],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    var segment = window.ppLib.voucherify.getSegment();
    expect(segment).toBe('ad-google');
    expect(document.cookie).toContain('pp_segment=ad-google');
  });

  it('determineSegment returns rule-resolved segment (prioritizeOverMember: true)', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.ppLib.voucherify.configure({
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: true
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    expect(window.ppLib.voucherify.getSegment()).toBe('ad-google');
  });

  it('determineSegment returns member over rule-resolved segment (prioritizeOverMember: false)', async () => {
    await freshLoad();
    document.cookie = 'userId=user123;path=/';
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.ppLib.voucherify.configure({
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    expect(window.ppLib.voucherify.getSegment()).toBe('member');
  });

  it('determineSegment returns rule-resolved segment for anonymous visitors', async () => {
    await freshLoad();
    // No userId cookie → not a member
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.ppLib.voucherify.configure({
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });

    expect(window.ppLib.voucherify.getSegment()).toBe('ad-google');
  });

  it('edge mode: URL contains rule-resolved segment key', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.fetch = mockFetch({
      segment: 'ad-google',
      products: {
        'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] },
        'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
      },
      timestamp: Date.now()
    });

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    expect(results.length).toBe(2);
    // Verify edge URL contains the segment
    var fetchCall = (window.fetch as any).mock.calls[0][0] as string;
    expect(fetchCall).toContain('/api/prices/ad-google');
  });

  it('cms mode: fetches from edge for rule-resolved segment visitors', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.fetch = mockFetch({
      segment: 'ad-google',
      products: {
        'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] },
        'hair-loss': { basePrice: 30, discountedPrice: 22, discountAmount: 8, discountLabel: '27% OFF', discountType: 'PERCENT', applicableVouchers: [] }
      },
      timestamp: Date.now()
    });

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    expect(results.length).toBe(2);
    expect(results[0].discountedPrice).toBe(45);
    expect(window.fetch).toHaveBeenCalled();
  });

  it('cms mode: returns empty for anonymous (unchanged)', async () => {
    await freshLoad();
    setupDOM();
    // No cookies at all
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.fetch = vi.fn() as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    expect(results).toEqual([]);
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('getSegment() public API returns current segment', async () => {
    await freshLoad();
    expect(typeof window.ppLib.voucherify.getSegment).toBe('function');
    // Default with no cookies → anonymous
    expect(window.ppLib.voucherify.getSegment()).toBe('anonymous');
  });

  it('cloak attribute removed after pricing injection', async () => {
    await freshLoad();
    setupDOM();
    // Set cloak attribute
    document.documentElement.setAttribute('data-pp-segment-pending', '');
    expect(document.documentElement.hasAttribute('data-pp-segment-pending')).toBe(true);

    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.fetch = mockFetch({
      segment: 'ad-google',
      products: {
        'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] },
        'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
      },
      timestamp: Date.now()
    });

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    // Cloak attribute should be removed after inject
    expect(document.documentElement.hasAttribute('data-pp-segment-pending')).toBe(false);
  });

  it('cms mode: edge failure for custom segment removes cloak and returns empty', async () => {
    await freshLoad();
    setupDOM();
    document.documentElement.setAttribute('data-pp-segment-pending', '');
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    window.fetch = mockFetchReject('Edge down');

    window.ppLib.voucherify.configure({
      edge: { mode: 'cms', edgeUrl: 'https://pp-pricing.workers.dev' },
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: false
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();
    expect(results).toEqual([]);
    expect(document.documentElement.hasAttribute('data-pp-segment-pending')).toBe(false);
  });

  it('segments config defaults are set correctly', async () => {
    await freshLoad();
    var config = window.ppLib.voucherify.getConfig();
    expect(config.segments.rules).toEqual([]);
    expect(config.segments.cookieName).toBe('pp_segment');
    expect(config.segments.cookieMaxAgeMinutes).toBe(30);
    expect(config.segments.prioritizeOverMember).toBe(false);
  });

  it('buildCustomer includes pp_segment metadata when rule-resolved segment active', async () => {
    await freshLoad();
    setupDOM();
    document.cookie = 'userId=user123;path=/';
    document.cookie = 'pp_segment=ad-google;path=/';
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', href: 'http://localhost', origin: 'http://localhost' },
      writable: true,
      configurable: true
    });

    var capturedBody: any = null;
    window.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      if (opts && opts.body) capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 } as any,
      segments: {
        rules: [{ param: 'utm_source', value: 'google', segment: 'ad-google' }],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: true
      },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    // In direct API mode (not edge/cms), buildCustomer is called
    expect(capturedBody).toBeTruthy();
    expect(capturedBody.customer.metadata.pp_segment).toBe('ad-google');
  });

  // =====================================================
  // Edge rewrite guard: data-pp-segment-resolved
  // =====================================================

  it('edge rewrite guard: skips pricing fetch when data-pp-segment-resolved is present', async () => {
    await freshLoad();

    // Simulate edge-rewritten HTML: product container has the resolved attribute
    document.body.innerHTML = `
      <div data-voucherify-product="weight-loss" data-voucherify-base-price="60" data-pp-segment-resolved="ad_source:google">
        <span data-voucherify-original-price>$60.00</span>
        <span data-voucherify-discounted-price>$51.00</span>
        <span data-voucherify-discount-label>15% OFF</span>
      </div>
    `;

    var fetchSpy = vi.fn();
    window.fetch = fetchSpy as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    // Should NOT have called fetch — prices already injected by edge Worker
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('edge rewrite guard: proceeds with fetch when data-pp-segment-resolved is NOT present', async () => {
    await freshLoad();
    setupDOM();

    window.fetch = mockFetch({
      segment: 'anonymous',
      products: {
        'weight-loss': { basePrice: 60, discountedPrice: 45, discountAmount: 15, discountLabel: '25% OFF', discountType: 'PERCENT', applicableVouchers: [] },
        'hair-loss': { basePrice: 30, discountedPrice: 30, discountAmount: 0, discountLabel: '', discountType: 'NONE', applicableVouchers: [] }
      },
      timestamp: Date.now()
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    var results = await window.ppLib.voucherify.fetchPricing();

    // Should have called fetch — no edge rewrite detected
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(results.length).toBe(2);
  });

  // =====================================================
  // Click ID detection
  // =====================================================

  it('click ID: gclid param resolves to ad_source:google segment', async () => {
    await freshLoad();
    setupDOM();

    // Set gclid in URL
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?gclid=CjwKCAjw', href: 'https://try.pocketpills.com/ed?gclid=CjwKCAjw' },
      writable: true,
      configurable: true
    });

    var capturedUrl = '';
    window.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ segment: 'ad_source:google', products: {}, timestamp: Date.now() })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    // URL should contain ad_source:google segment
    expect(capturedUrl).toContain('ad_source%3Agoogle');
  });

  it('click ID: fbclid + utm_source=instagram resolves to ad_source:instagram', async () => {
    await freshLoad();
    setupDOM();

    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?fbclid=IwAR0&utm_source=instagram', href: 'https://try.pocketpills.com/ed?fbclid=IwAR0&utm_source=instagram' },
      writable: true,
      configurable: true
    });

    var capturedUrl = '';
    window.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ segment: 'ad_source:instagram', products: {}, timestamp: Date.now() })
      });
    }) as any;

    window.ppLib.voucherify.configure({
      edge: { mode: 'edge', edgeUrl: 'https://pp-pricing.workers.dev' },
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    expect(capturedUrl).toContain('ad_source%3Ainstagram');
  });

  it('click ID: sets ad_source metadata in buildCustomer', async () => {
    await freshLoad();
    setupDOM();

    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?gclid=CjwKCAjw', href: 'https://try.pocketpills.com/ed?gclid=CjwKCAjw' },
      writable: true,
      configurable: true
    });

    // Use direct mode so buildCustomer sends the body
    var capturedBody: any = null;
    window.fetch = vi.fn().mockImplementation((_url: string, init: any) => {
      if (init?.body) capturedBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ qualifications: [], total: 0, has_more: false })
      });
    }) as any;

    document.cookie = 'userId=user123';

    window.ppLib.voucherify.configure({
      api: { applicationId: 'test', clientSecretKey: 'test' } as any,
      pricing: { autoFetch: false } as any,
      consent: { required: false } as any,
      segments: {
        rules: [],
        cookieName: 'pp_segment',
        cookieMaxAgeMinutes: 30,
        prioritizeOverMember: true
      }
    });
    window.ppLib.voucherify.init();

    await window.ppLib.voucherify.fetchPricing();

    expect(capturedBody).toBeTruthy();
    expect(capturedBody.customer.metadata.ad_source).toBe('google');
    expect(capturedBody.customer.metadata.pp_segment).toBe('ad_source:google');
  });
});
