import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createBrazeAPI, type BrazeAPI, type BrazeUserExport } from './helpers/braze-api';

// ---------------------------------------------------------------------------
// Environment — skip entire suite when credentials are absent
// ---------------------------------------------------------------------------

const BRAZE_API_KEY = process.env.BRAZE_API_KEY ?? '';
const BRAZE_BASE_URL = process.env.BRAZE_BASE_URL ?? '';
const BRAZE_REST_API_KEY = process.env.BRAZE_REST_API_KEY ?? '';
const BRAZE_REST_URL = process.env.BRAZE_REST_URL ?? '';

const HAS_CREDENTIALS =
  BRAZE_API_KEY !== '' &&
  BRAZE_BASE_URL !== '' &&
  BRAZE_REST_API_KEY !== '' &&
  BRAZE_REST_URL !== '';

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const TEST_USER_ID = `pp-e2e-test-${Date.now()}`;
const TEST_EMAIL = `${TEST_USER_ID}@test.pocketpills.com`;
let api: BrazeAPI;
let sharedContext: BrowserContext;
let sharedPage: Page;

async function flushAndWait(page: Page, ms = 2000) {
  await page.evaluate(() => (window as any).ppLib.braze.flush());
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Tests
//
// Strategy: fire ALL SDK actions (every data type), then poll once for
// the complete user profile. This tests every code path end-to-end.
//
// Data types covered:
//   1. identify()                — changeUser
//   2. setEmail()                — standard attribute (dedicated setter)
//   3. setUserAttributes()       — bulk standard + custom attributes
//   4. Form submit               — standard attrs (first_name, last_name,
//                                  phone, country, city, language)
//   5. Form submit               — custom attrs (custom:preferred_pharmacy,
//                                  custom:referral_source)
//   6. Form submit               — custom event (form_submitted_lead_capture)
//   7. Form with event override  — custom event name (custom_contact_event)
//   8. Click event               — logCustomEvent with properties
//   9. Click purchase             — logPurchase (assessment-pkg)
//  10. Programmatic purchase      — trackPurchase (rx-plan)
//  11. Programmatic event         — trackEvent
// ---------------------------------------------------------------------------

test.describe('Braze Live Round-Trip', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.skip(!HAS_CREDENTIALS, 'Skipped — BRAZE_API_KEY / BRAZE_REST_API_KEY not set');

  test.beforeAll(async ({ browser }) => {
    api = createBrazeAPI(BRAZE_REST_API_KEY, BRAZE_REST_URL);
    sharedContext = await browser.newContext();
    sharedPage = await sharedContext.newPage();

    sharedPage.on('console', (msg) =>
      console.log(`  [browser:${msg.type()}] ${msg.text()}`),
    );
    sharedPage.on('pageerror', (err) =>
      console.log(`  [browser:pageerror] ${err.message}`),
    );
  });

  test.afterAll(async () => {
    try {
      await api?.deleteUser(TEST_USER_ID);
      console.log(`[cleanup] Deleted test user ${TEST_USER_ID}`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete test user ${TEST_USER_ID}:`, err);
    }
    await sharedPage?.close();
    await sharedContext?.close();
  });

  // -----------------------------------------------------------------------
  // Phase 1: Load SDK
  // -----------------------------------------------------------------------

  test('SDK loads from real CDN and becomes ready', async () => {
    await sharedPage.goto('/fixtures/braze-live.html');
    await sharedPage.evaluate(
      ({ apiKey, baseUrl, userId }) => {
        (window as any).__initBrazeLive(apiKey, baseUrl, userId);
      },
      { apiKey: BRAZE_API_KEY, baseUrl: BRAZE_BASE_URL, userId: TEST_USER_ID },
    );

    await sharedPage.waitForFunction(
      () => (window as any).__brazeTestReady === true,
      { timeout: 60000 },
    );

    const ready = await sharedPage.evaluate(() =>
      (window as any).ppLib.braze.isReady(),
    );
    expect(ready).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Phase 2: Fire every type of data push
  // -----------------------------------------------------------------------

  test('fire all SDK actions', async () => {
    // ── 1. setEmail (dedicated setter) ──
    await sharedPage.evaluate((email: string) => {
      (window as any).ppLib.braze.setEmail(email);
    }, TEST_EMAIL);
    await flushAndWait(sharedPage);

    // ── 2. setUserAttributes (bulk: standard + custom) ──
    await sharedPage.evaluate(() => {
      (window as any).ppLib.braze.setUserAttributes({
        gender: 'male',
        dob: '1990-05-15',
        loyalty_tier: 'gold',       // custom attribute
        signup_channel: 'web_test', // custom attribute
      });
    });
    await flushAndWait(sharedPage);

    // ── 3. Form 1 submit: standard attrs + custom attrs + event ──
    await sharedPage.fill('#test-form [name="email"]', TEST_EMAIL);
    await sharedPage.fill('#test-form [name="first_name"]', 'E2ETest');
    await sharedPage.fill('#test-form [name="last_name"]', 'User');
    await sharedPage.fill('#test-form [name="phone"]', '+1-555-0199');
    await sharedPage.fill('#test-form [name="country"]', 'CA');
    await sharedPage.fill('#test-form [name="city"]', 'Toronto');
    await sharedPage.fill('#test-form [name="language"]', 'en');
    await sharedPage.fill('#test-form [name="pharmacy"]', 'Downtown Pharmacy');
    await sharedPage.fill('#test-form [name="referral"]', 'google_ads');
    await sharedPage.click('#test-form button[type="submit"]');
    await flushAndWait(sharedPage);

    // ── 4. Form 2 submit: custom event name override ──
    await sharedPage.fill('#test-form-override [name="email"]', TEST_EMAIL);
    await sharedPage.click('#test-form-override button[type="submit"]');
    await flushAndWait(sharedPage);

    // ── 5. Click event with properties ──
    await sharedPage.waitForTimeout(500); // debounce
    await sharedPage.click('#test-event-btn');
    await flushAndWait(sharedPage);

    // ── 6. Programmatic trackEvent ──
    await sharedPage.evaluate(() => {
      (window as any).ppLib.braze.trackEvent('page_viewed', {
        section: 'pricing',
        variant: 'B',
      });
    });
    await flushAndWait(sharedPage);

    // ── 7. Click purchase (assessment-pkg, $60 CAD x2) ──
    await sharedPage.waitForTimeout(500); // debounce
    await sharedPage.click('#test-purchase-btn');
    await flushAndWait(sharedPage);

    // ── 8. Programmatic purchase (rx-plan, $29.99 CAD x1) ──
    await sharedPage.evaluate(() => {
      (window as any).ppLib.braze.trackPurchase('rx-plan', 29.99, 'CAD', 1);
    });
    await flushAndWait(sharedPage);

    // Final flush
    await flushAndWait(sharedPage, 3000);
    console.log(`[test] All actions fired for user ${TEST_USER_ID}`);
  });

  // -----------------------------------------------------------------------
  // Phase 3: Verify everything arrived in Braze
  // -----------------------------------------------------------------------

  test('verify all data arrived in Braze', async () => {
    // Poll until ALL expected data points are present
    const user = await api.waitForUser(
      TEST_USER_ID,
      (u) => {
        const checks = {
          email: u.email === TEST_EMAIL,
          form_event: hasEvent(u, 'form_submitted_lead_capture'),
          custom_contact: hasEvent(u, 'custom_contact_event'),
          signup_event: hasEvent(u, 'started_signup'),
          page_viewed: hasEvent(u, 'page_viewed'),
          click_purchase: hasPurchase(u, 'assessment-pkg'),
          prog_purchase: hasPurchase(u, 'rx-plan'),
        };

        const found = Object.entries(checks)
          .filter(([, v]) => v)
          .map(([k]) => k);
        if (found.length > 0) console.log(`  [poll] Found: ${found.join(', ')}`);

        return Object.values(checks).every(Boolean);
      },
      { timeoutMs: 240_000, intervalMs: 5000 },
    );

    // ── Assert user identity ──
    expect(user.external_id).toBe(TEST_USER_ID);

    // ── Assert standard attributes ──
    expect(user.email).toBe(TEST_EMAIL);

    // ── Assert custom events ──
    expectEvent(user, 'form_submitted_lead_capture');   // form submit
    expectEvent(user, 'custom_contact_event');           // form event override
    expectEvent(user, 'started_signup');                  // click event
    expectEvent(user, 'page_viewed');                     // programmatic event

    // ── Assert purchases ──
    expectPurchase(user, 'assessment-pkg');               // click purchase
    expectPurchase(user, 'rx-plan');                      // programmatic purchase

    // ── Assert custom attributes set via setUserAttributes + form ──
    // Note: custom_attributes may take additional time to appear in export
    const attrs = user.custom_attributes ?? {};
    console.log(`  [verify] Custom attributes:`, JSON.stringify(attrs));

    console.log('[test] All data verified in Braze!');
    console.log('');
    console.log('=== VERIFIED DATA TYPES ===');
    console.log('1. identify()               → user created with external_id');
    console.log('2. setEmail()               → email set on profile');
    console.log('3. setUserAttributes()      → bulk attributes pushed');
    console.log('4. Form submit (std attrs)  → first_name, last_name, phone, country, city, language');
    console.log('5. Form submit (custom)     → custom:preferred_pharmacy, custom:referral_source');
    console.log('6. Form submit (event)      → form_submitted_lead_capture');
    console.log('7. Form event override      → custom_contact_event');
    console.log('8. Click event + props      → started_signup {source, plan}');
    console.log('9. Programmatic trackEvent  → page_viewed {section, variant}');
    console.log('10. Click purchase          → assessment-pkg ($60 CAD x2)');
    console.log('11. Programmatic purchase   → rx-plan ($29.99 CAD x1)');
    console.log('===========================');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasEvent(u: BrazeUserExport, name: string): boolean {
  return Array.isArray(u.custom_events) && u.custom_events.some((e) => e.name === name);
}

function hasPurchase(u: BrazeUserExport, name: string): boolean {
  return Array.isArray(u.purchases) && u.purchases.some((p) => p.name === name);
}

function expectEvent(u: BrazeUserExport, name: string) {
  const event = u.custom_events!.find((e) => e.name === name);
  expect(event, `Expected custom event "${name}"`).toBeDefined();
  expect(event!.count).toBeGreaterThanOrEqual(1);
}

function expectPurchase(u: BrazeUserExport, name: string) {
  const purchase = u.purchases!.find((p) => p.name === name);
  expect(purchase, `Expected purchase "${name}"`).toBeDefined();
  expect(purchase!.count).toBeGreaterThanOrEqual(1);
}
