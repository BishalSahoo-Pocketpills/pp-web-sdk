import { test, expect } from '@playwright/test';
import { mockVoucherifyAPI } from './helpers/voucherify-mock';

// =====================================================================
// Helper: navigate to fixture with mock API
// =====================================================================

async function setupPage(page: import('@playwright/test').Page, responses?: any) {
  await mockVoucherifyAPI(page, responses);
  await page.goto('/fixtures/voucherify-test.html');
  // Wait for ppLib.voucherify to be available
  await page.waitForFunction(
    () => (window as any).ppLib && (window as any).ppLib.voucherify,
    { timeout: 10000 }
  );
}

// =====================================================================
// SDK LIFECYCLE
// =====================================================================

test.describe('SDK Lifecycle', () => {
  test('loads common.min.js and voucherify.min.js without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockVoucherifyAPI(page);
    await page.goto('/fixtures/voucherify-test.html');
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('ppLib.voucherify is available after scripts load', async ({ page }) => {
    await setupPage(page);

    const hasVoucherify = await page.evaluate(() =>
      !!(window as any).ppLib && !!(window as any).ppLib.voucherify
    );
    expect(hasVoucherify).toBe(true);
  });

  test('isReady() returns true immediately (no CDN loading needed)', async ({ page }) => {
    await setupPage(page);

    const ready = await page.evaluate(() =>
      (window as any).ppLib.voucherify.isReady()
    );
    expect(ready).toBe(true);
  });
});

// =====================================================================
// CONFIGURATION
// =====================================================================

test.describe('Configuration', () => {
  test('configure() merges custom options into config', async ({ page }) => {
    await setupPage(page);

    const config = await page.evaluate(() =>
      (window as any).ppLib.voucherify.getConfig()
    );

    expect(config.api.applicationId).toBe('test-app-id');
    expect(config.api.clientSecretKey).toBe('test-client-key');
    expect(config.api.baseUrl).toBe('https://as1.api.voucherify.io');
    // Default values still present
    expect(config.cache.enabled).toBe(false);
    expect(config.cache.ttl).toBe(300000);
  });

  test('getConfig() returns the current configuration', async ({ page }) => {
    await setupPage(page);

    const config = await page.evaluate(() =>
      (window as any).ppLib.voucherify.getConfig()
    );

    expect(config).toHaveProperty('api');
    expect(config).toHaveProperty('cache');
    expect(config).toHaveProperty('pricing');
    expect(config).toHaveProperty('context');
    expect(config).toHaveProperty('consent');
  });
});

// =====================================================================
// FETCH PRICING
// =====================================================================

test.describe('Fetch Pricing', () => {
  test('fetchPricing() returns results and injects into DOM', async ({ page }) => {
    await setupPage(page);

    const results = await page.evaluate(async () => {
      return (window as any).ppLib.voucherify.fetchPricing();
    });

    expect(results).toHaveLength(3);
    expect(results[0].productId).toBe('weight-loss');
    expect(results[0].basePrice).toBe(60);
  });

  test('injects original price into DOM', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    const originalPrice = await page.textContent('[data-voucherify-product="weight-loss"] [data-voucherify-original-price]');
    expect(originalPrice).toContain('60');
  });

  test('injects discounted price into DOM', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    const discountedPrice = await page.textContent('[data-voucherify-product="weight-loss"] [data-voucherify-discounted-price]');
    // 60 - 25% = 45
    expect(discountedPrice).toContain('45');
  });

  test('shows discount label', async ({ page }) => {
    await setupPage(page);

    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    const label = await page.textContent('[data-voucherify-product="weight-loss"] [data-voucherify-discount-label]');
    expect(label).toBe('25% OFF');
  });

  test('no discount shows base price in discounted slot', async ({ page }) => {
    // Mock with empty qualifications (no discounts)
    await setupPage(page, {
      qualifications: { qualifications: [], total: 0, has_more: false }
    });

    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    const discountedPrice = await page.textContent('[data-voucherify-product="weight-loss"] [data-voucherify-discounted-price]');
    expect(discountedPrice).toContain('60');

    const label = await page.textContent('[data-voucherify-product="weight-loss"] [data-voucherify-discount-label]');
    expect(label).toBe('');
  });

  test('manual fetchPricing() with specific product IDs works', async ({ page }) => {
    await setupPage(page);

    const results = await page.evaluate(async () => {
      return (window as any).ppLib.voucherify.fetchPricing(['weight-loss']);
    });

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('weight-loss');
  });
});

// =====================================================================
// VALIDATE VOUCHER
// =====================================================================

test.describe('Validate Voucher', () => {
  test('validateVoucher() validates a code successfully', async ({ page }) => {
    await setupPage(page);

    const result = await page.evaluate(async () => {
      return (window as any).ppLib.voucherify.validateVoucher('TESTCODE');
    });

    expect(result.valid).toBe(true);
    expect(result.code).toBe('TESTCODE');
  });

  test('validateVoucher() returns invalid for bad code', async ({ page }) => {
    await setupPage(page, {
      validations: {
        redeemables: [{
          status: 'INAPPLICABLE',
          id: 'BADCODE',
          result: {}
        }]
      }
    });

    const result = await page.evaluate(async () => {
      return (window as any).ppLib.voucherify.validateVoucher('BADCODE');
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('INAPPLICABLE');
  });
});

// =====================================================================
// CACHING
// =====================================================================

test.describe('Caching', () => {
  test('cache prevents duplicate API requests', async ({ page }) => {
    let requestCount = 0;

    await page.route('**/api.voucherify.io/client/v1/qualifications', async (route) => {
      requestCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 10 } } }],
          total: 1,
          has_more: false
        })
      });
    });

    await page.goto('/fixtures/voucherify-test.html');
    await page.waitForFunction(
      () => (window as any).ppLib && (window as any).ppLib.voucherify,
      { timeout: 10000 }
    );

    // Call fetchPricing twice with same products
    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    // Only one API call should have been made
    expect(requestCount).toBe(1);
  });

  test('clearCache() allows subsequent refetch', async ({ page }) => {
    let requestCount = 0;

    await page.route('**/api.voucherify.io/client/v1/qualifications', async (route) => {
      requestCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          qualifications: [],
          total: 0,
          has_more: false
        })
      });
    });

    await page.goto('/fixtures/voucherify-test.html');
    await page.waitForFunction(
      () => (window as any).ppLib && (window as any).ppLib.voucherify,
      { timeout: 10000 }
    );

    await page.evaluate(async () => {
      await (window as any).ppLib.voucherify.fetchPricing();
      (window as any).ppLib.voucherify.clearCache();
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    expect(requestCount).toBe(2);
  });
});

// =====================================================================
// BACKEND CACHE MODE
// =====================================================================

test.describe('Backend Cache Mode', () => {
  test('routes requests to backend proxy when cache.enabled is true', async ({ page }) => {
    let backendHit = false;

    await page.route('**/api/voucherify/qualifications', async (route) => {
      backendHit = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          qualifications: [{ id: 'v1', result: { discount: { type: 'PERCENT', percent_off: 15 } } }],
          total: 1,
          has_more: false
        })
      });
    });

    await page.goto('/fixtures/voucherify-test.html');
    await page.waitForFunction(
      () => (window as any).ppLib && (window as any).ppLib.voucherify,
      { timeout: 10000 }
    );

    await page.evaluate(async () => {
      (window as any).ppLib.voucherify.configure({
        cache: { enabled: true, baseUrl: '/api/voucherify' }
      });
      await (window as any).ppLib.voucherify.fetchPricing();
    });

    expect(backendHit).toBe(true);
  });
});
