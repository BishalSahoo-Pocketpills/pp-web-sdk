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

  it('warns when API credentials are exposed in direct API mode', async () => {
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
      'warn',
      expect.stringContaining('Direct API mode exposes credentials')
    );
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
});
