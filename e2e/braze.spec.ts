import { test, expect } from '@playwright/test';
import { mockBrazeCDN, getBrazeCalls, getBrazeUserAttrs, getBrazeCustomAttrs } from './helpers/braze-mock';

// =====================================================================
// Helper: navigate to fixture with mock CDN and wait for SDK init
// =====================================================================

async function setupPage(page: import('@playwright/test').Page) {
  await mockBrazeCDN(page);
  await page.goto('/fixtures/braze-test.html');
  // Wait for SDK to initialize (initialize + openSession are the first two calls)
  await page.waitForFunction(
    () => (window as any).braze && (window as any).braze._calls &&
          (window as any).braze._calls.some((c: any) => c[0] === 'openSession'),
    { timeout: 10000 }
  );
}

// =====================================================================
// SDK LIFECYCLE
// =====================================================================

test.describe('SDK Lifecycle', () => {
  test('loads common.min.js and braze.min.js without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockBrazeCDN(page);
    await page.goto('/fixtures/braze-test.html');
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('ppLib.braze is available after scripts load', async ({ page }) => {
    await setupPage(page);

    const hasBraze = await page.evaluate(() =>
      !!(window as any).ppLib && !!(window as any).ppLib.braze
    );
    expect(hasBraze).toBe(true);
  });

  test('intercepts Braze CDN and injects mock SDK', async ({ page }) => {
    await setupPage(page);

    const hasMockBraze = await page.evaluate(() =>
      !!(window as any).braze && Array.isArray((window as any).braze._calls)
    );
    expect(hasMockBraze).toBe(true);
  });

  test('calls braze.initialize() and braze.openSession() on init', async ({ page }) => {
    await setupPage(page);

    const calls = await getBrazeCalls(page);
    const methodNames = calls.map((c: any) => c[0]);

    expect(methodNames).toContain('initialize');
    expect(methodNames).toContain('openSession');

    // Verify initialize was called with the correct apiKey
    const initCall = calls.find((c: any) => c[0] === 'initialize');
    expect(initCall[1]).toBe('test-key-123');
    expect(initCall[2]).toMatchObject({ baseUrl: 'sdk.iad-01.braze.com' });
  });
});

// =====================================================================
// CONFIGURATION
// =====================================================================

test.describe('Configuration', () => {
  test('configure() merges custom options into config', async ({ page }) => {
    await setupPage(page);

    const config = await page.evaluate(() =>
      (window as any).ppLib.braze.getConfig()
    );

    expect(config.sdk.apiKey).toBe('test-key-123');
    expect(config.sdk.baseUrl).toBe('sdk.iad-01.braze.com');
    // Default values still present
    expect(config.sdk.sessionTimeoutInSeconds).toBe(1800);
  });

  test('getConfig() returns the current configuration', async ({ page }) => {
    await setupPage(page);

    const config = await page.evaluate(() =>
      (window as any).ppLib.braze.getConfig()
    );

    expect(config).toHaveProperty('sdk');
    expect(config).toHaveProperty('consent');
    expect(config).toHaveProperty('identity');
    expect(config).toHaveProperty('form');
    expect(config).toHaveProperty('event');
    expect(config).toHaveProperty('purchase');
  });

  test('isReady() returns true after SDK loads', async ({ page }) => {
    await setupPage(page);

    const ready = await page.evaluate(() =>
      (window as any).ppLib.braze.isReady()
    );
    expect(ready).toBe(true);
  });
});

// =====================================================================
// FORM HANDLING
// =====================================================================

test.describe('Form Handling', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('form submit calls logCustomEvent with form_submitted_ prefix', async ({ page }) => {
    await page.fill('#test-form [name="email"]', 'test@example.com');
    await page.click('#test-form button[type="submit"]');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const eventCalls = calls.filter((c: any) => c[0] === 'logCustomEvent');
    const formEvent = eventCalls.find((c: any) => c[1] === 'form_submitted_lead_capture');

    expect(formEvent).toBeDefined();
    expect(formEvent[2]).toMatchObject({ form_name: 'lead_capture' });
  });

  test('form submit sets standard user attributes (email, first_name, phone)', async ({ page }) => {
    await page.fill('#test-form [name="email"]', 'test@example.com');
    await page.fill('#test-form [name="first_name"]', 'Jane');
    await page.fill('#test-form [name="phone"]', '555-1234');
    await page.click('#test-form button[type="submit"]');
    await page.waitForTimeout(100);

    const userAttrs = await getBrazeUserAttrs(page);
    expect(userAttrs.email).toBe('test@example.com');
    expect(userAttrs.first_name).toBe('Jane');
    expect(userAttrs.phone).toBe('555-1234');
  });

  test('form submit sets custom user attributes (custom: prefix)', async ({ page }) => {
    await page.fill('#test-form [name="email"]', 'test@example.com');
    await page.fill('#test-form [name="pharmacy"]', 'Downtown Pharmacy');
    await page.click('#test-form button[type="submit"]');
    await page.waitForTimeout(100);

    const customAttrs = await getBrazeCustomAttrs(page);
    expect(customAttrs.preferred_pharmacy).toBe('Downtown Pharmacy');
  });

  test('form with data-braze-form-event uses custom event name', async ({ page }) => {
    await page.fill('#test-form-override [name="email"]', 'contact@example.com');
    await page.click('#test-form-override button[type="submit"]');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const eventCalls = calls.filter((c: any) => c[0] === 'logCustomEvent');
    const customEvent = eventCalls.find((c: any) => c[1] === 'custom_contact_event');

    expect(customEvent).toBeDefined();
  });

  test('form submit calls requestImmediateDataFlush', async ({ page }) => {
    await page.fill('#test-form [name="email"]', 'test@example.com');
    await page.click('#test-form button[type="submit"]');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const flushCalls = calls.filter((c: any) => c[0] === 'requestImmediateDataFlush');
    expect(flushCalls.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// EVENT TRACKING
// =====================================================================

test.describe('Event Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('click on data-braze-event element calls logCustomEvent', async ({ page }) => {
    await page.click('#test-event-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const eventCalls = calls.filter((c: any) => c[0] === 'logCustomEvent');
    const signupEvent = eventCalls.find((c: any) => c[1] === 'started_signup');

    expect(signupEvent).toBeDefined();
  });

  test('click extracts data-braze-prop-* as event properties', async ({ page }) => {
    await page.click('#test-event-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const signupEvent = calls.find(
      (c: any) => c[0] === 'logCustomEvent' && c[1] === 'started_signup'
    );

    expect(signupEvent).toBeDefined();
    expect(signupEvent[2]).toMatchObject({
      source: 'hero_banner',
      plan: 'premium',
    });
  });

  test('event properties include page context (url, path, title)', async ({ page }) => {
    await page.click('#test-event-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const signupEvent = calls.find(
      (c: any) => c[0] === 'logCustomEvent' && c[1] === 'started_signup'
    );

    expect(signupEvent[2]).toHaveProperty('page_url');
    expect(signupEvent[2]).toHaveProperty('page_path');
    expect(signupEvent[2]).toHaveProperty('page_title');
    expect(signupEvent[2].page_title).toBe('Braze Integration Test');
  });

  test('debounce prevents duplicate events within 300ms', async ({ page }) => {
    // Click rapidly 3 times
    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const signupEvents = calls.filter(
      (c: any) => c[0] === 'logCustomEvent' && c[1] === 'started_signup'
    );

    // Debounce should allow only 1 event
    expect(signupEvents.length).toBe(1);
  });
});

// =====================================================================
// PURCHASE TRACKING
// =====================================================================

test.describe('Purchase Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('click on data-braze-purchase element calls logPurchase', async ({ page }) => {
    await page.click('#test-purchase-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const purchaseCalls = calls.filter((c: any) => c[0] === 'logPurchase');

    expect(purchaseCalls.length).toBe(1);
    expect(purchaseCalls[0][1]).toBe('assessment-pkg');
  });

  test('purchase includes price, currency, and quantity from attributes', async ({ page }) => {
    await page.click('#test-purchase-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const purchaseCall = calls.find((c: any) => c[0] === 'logPurchase');

    expect(purchaseCall).toBeDefined();
    // logPurchase(id, price, currency, quantity)
    expect(purchaseCall[1]).toBe('assessment-pkg');
    expect(purchaseCall[2]).toBe(60);
    expect(purchaseCall[3]).toBe('CAD');
    expect(purchaseCall[4]).toBe(2);
  });

  test('programmatic trackPurchase() calls logPurchase', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).ppLib.braze.trackPurchase('rx-plan', 29.99, 'CAD', 1);
    });
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const purchaseCall = calls.find(
      (c: any) => c[0] === 'logPurchase' && c[1] === 'rx-plan'
    );

    expect(purchaseCall).toBeDefined();
    expect(purchaseCall[2]).toBe(29.99);
    expect(purchaseCall[3]).toBe('CAD');
    expect(purchaseCall[4]).toBe(1);
  });

  test('purchase debounce prevents duplicates', async ({ page }) => {
    await page.click('#test-purchase-btn');
    await page.click('#test-purchase-btn');
    await page.click('#test-purchase-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const purchaseCalls = calls.filter((c: any) => c[0] === 'logPurchase');

    expect(purchaseCalls.length).toBe(1);
  });
});

// =====================================================================
// IDENTITY
// =====================================================================

test.describe('Identity', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('identify() calls braze.changeUser()', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).ppLib.braze.identify('user-abc-123');
    });
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const changeUserCall = calls.find(
      (c: any) => c[0] === 'changeUser' && c[1] === 'user-abc-123'
    );

    expect(changeUserCall).toBeDefined();
  });

  test('auto-identify reads userId from cookie', async ({ page }) => {
    // Set cookie before page loads
    await mockBrazeCDN(page);
    await page.context().addCookies([{
      name: 'userId',
      value: 'cookie-user-42',
      domain: 'localhost',
      path: '/',
    }]);
    await page.goto('/fixtures/braze-test.html');
    await page.waitForFunction(
      () => (window as any).braze && (window as any).braze._calls &&
            (window as any).braze._calls.some((c: any) => c[0] === 'openSession'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(200);

    const calls = await getBrazeCalls(page);
    const changeUserCall = calls.find(
      (c: any) => c[0] === 'changeUser' && c[1] === 'cookie-user-42'
    );

    expect(changeUserCall).toBeDefined();
  });

  test('setEmail() calls braze.getUser().setEmail()', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).ppLib.braze.setEmail('direct@example.com');
    });
    await page.waitForTimeout(100);

    const userAttrs = await getBrazeUserAttrs(page);
    expect(userAttrs.email).toBe('direct@example.com');
  });
});

// =====================================================================
// EDGE CASES
// =====================================================================

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test('elements without data-braze-* attributes are ignored', async ({ page }) => {
    const callsBefore = await getBrazeCalls(page);
    const countBefore = callsBefore.length;

    await page.click('#plain-btn');
    await page.waitForTimeout(100);

    const callsAfter = await getBrazeCalls(page);
    // No new logCustomEvent or logPurchase calls
    const newEventCalls = callsAfter.slice(countBefore).filter(
      (c: any) => c[0] === 'logCustomEvent' || c[0] === 'logPurchase'
    );
    expect(newEventCalls.length).toBe(0);
  });

  test('form with empty required email is rejected (requireEmail: true)', async ({ page }) => {
    // Configure requireEmail
    await page.evaluate(() => {
      (window as any).ppLib.braze.configure({ form: { requireEmail: true } });
    });

    const callsBefore = await getBrazeCalls(page);
    const countBefore = callsBefore.length;

    // Submit form without filling email
    await page.fill('#test-form [name="first_name"]', 'Jane');
    await page.click('#test-form button[type="submit"]');
    await page.waitForTimeout(100);

    const callsAfter = await getBrazeCalls(page);
    const newEventCalls = callsAfter.slice(countBefore).filter(
      (c: any) => c[0] === 'logCustomEvent'
    );
    // Should be rejected — no event logged
    expect(newEventCalls.length).toBe(0);
  });

  test('multiple rapid clicks only fire one event (debounce)', async ({ page }) => {
    // Wait for debounce window to expire from any prior tests
    await page.waitForTimeout(400);

    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.click('#test-event-btn');
    await page.waitForTimeout(100);

    const calls = await getBrazeCalls(page);
    const signupEvents = calls.filter(
      (c: any) => c[0] === 'logCustomEvent' && c[1] === 'started_signup'
    );

    expect(signupEvents.length).toBe(1);
  });
});
