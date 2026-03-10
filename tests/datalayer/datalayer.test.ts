import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { setCookie } from '../helpers/mock-cookies.ts';
import { createMockDataLayer } from '../helpers/mock-datalayer.ts';
import { createDataLayerDOM } from '../helpers/mock-dom.ts';
import crypto from 'crypto';

// Polyfill Web Crypto for jsdom
beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    vi.stubGlobal('crypto', crypto.webcrypto);
  }
});

/** Compute SHA-256 hex digest (for test assertions). */
async function sha256hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.toLowerCase().trim());
  const buf = await crypto.webcrypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// =========================================================================
// 1. IIFE BOOTSTRAP
// =========================================================================
describe('IIFE Bootstrap', () => {
  it('calls initModule immediately when ppLib._isReady is true', () => {
    loadWithCommon('datalayer');
    expect(window.ppLib).toBeDefined();
    expect(window.ppLib._isReady).toBe(true);
    expect(window.ppLib.datalayer).toBeDefined();
  });

  it('pushes initModule to ppLibReady when ppLib is not available', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('datalayer');

    expect(window.ppLib).toBeUndefined();
    expect(window.ppLibReady).toBeDefined();
    expect(Array.isArray(window.ppLibReady)).toBe(true);
    expect(window.ppLibReady.length).toBe(1);
    expect(typeof window.ppLibReady[0]).toBe('function');
  });

  it('ppLibReady callback is consumed when common loads afterwards', () => {
    delete window.ppLib;
    delete window.ppLibReady;

    loadModule('datalayer');
    expect(window.ppLibReady.length).toBe(1);

    loadModule('common');
    expect(window.ppLib.datalayer).toBeDefined();
  });

  it('auto-fires pageview event on module load', async () => {
    createMockDataLayer();
    loadWithCommon('datalayer');

    // Auto-pageview waits for async user data hashing
    await vi.waitFor(() => {
      const events = window.dataLayer.filter((e: any) => e.event === 'pageview');
      expect(events.length).toBe(1);
    });

    const events = window.dataLayer.filter((e: any) => e.event === 'pageview');
    expect(events[0].platform).toBe('web');
    expect(events[0].user).toBeDefined();
    expect(events[0].page).toBeDefined();
    expect(events[0].pp_timestamp).toBeDefined();
  });

  it('exposes ppLib.datalayer public API with all expected methods', () => {
    loadWithCommon('datalayer');
    const api = window.ppLib.datalayer;
    expect(typeof api.configure).toBe('function');
    expect(typeof api.setUser).toBe('function');
    expect(typeof api.setUserData).toBe('function');
    expect(typeof api.setUserDataHashed).toBe('function');
    expect(typeof api.push).toBe('function');
    expect(typeof api.pushEcommerce).toBe('function');
    expect(typeof api.pageview).toBe('function');
    expect(typeof api.loginView).toBe('function');
    expect(typeof api.loginSuccess).toBe('function');
    expect(typeof api.signupView).toBe('function');
    expect(typeof api.signupStart).toBe('function');
    expect(typeof api.signupComplete).toBe('function');
    expect(typeof api.search).toBe('function');
    expect(typeof api.viewItem).toBe('function');
    expect(typeof api.addToCart).toBe('function');
    expect(typeof api.beginCheckout).toBe('function');
    expect(typeof api.addPaymentInfo).toBe('function');
    expect(typeof api.purchase).toBe('function');
    expect(typeof api.init).toBe('function');
    expect(typeof api.bindDOM).toBe('function');
    expect(typeof api.getConfig).toBe('function');
  });
});

// =========================================================================
// 2. CONFIGURATION
// =========================================================================
describe('Configuration', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
  });

  it('has correct defaults', () => {
    const config = window.ppLib.datalayer.getConfig();
    expect(config.cookieNames).toEqual({
      userId: 'userId',
      patientId: 'patientId',
      firstName: 'firstName',
      lastName: 'lastName',
      appAuth: 'app_is_authenticated',
      email: 'email',
      phone: 'phone',
      street: 'street',
      city: 'city',
      region: 'region',
      postalCode: 'postalCode',
      country: 'country'
    });
    expect(config.defaults).toEqual({ itemBrand: 'Pocketpills', currency: 'CAD', platform: 'web' });
  });

  it('deep merges options via configure()', () => {
    const result = window.ppLib.datalayer.configure({
      cookieNames: { userId: 'uid' },
      defaults: { currency: 'USD' }
    });
    expect(result.cookieNames.userId).toBe('uid');
    expect(result.cookieNames.patientId).toBe('patientId');
    expect(result.defaults.currency).toBe('USD');
    expect(result.defaults.itemBrand).toBe('Pocketpills');
  });

  it('returns CONFIG when called with no arguments', () => {
    const result = window.ppLib.datalayer.configure();
    expect(result).toBeDefined();
    expect(result.cookieNames).toBeDefined();
  });

  it('has attributes map defaults for all data-dl-* attributes', () => {
    const config = window.ppLib.datalayer.getConfig();
    expect(config.attributes.event).toBe('data-dl-event');
    expect(config.attributes.method).toBe('data-dl-method');
    expect(config.attributes.pageType).toBe('data-dl-page-type');
    expect(config.attributes.signupFlow).toBe('data-dl-signup-flow');
    expect(config.attributes.searchTerm).toBe('data-dl-search-term');
    expect(config.attributes.resultsCount).toBe('data-dl-results-count');
    expect(config.attributes.searchType).toBe('data-dl-search-type');
    expect(config.attributes.itemId).toBe('data-dl-item-id');
    expect(config.attributes.itemName).toBe('data-dl-item-name');
    expect(config.attributes.itemBrand).toBe('data-dl-item-brand');
    expect(config.attributes.itemCategory).toBe('data-dl-item-category');
    expect(config.attributes.price).toBe('data-dl-item-price');
    expect(config.attributes.quantity).toBe('data-dl-quantity');
    expect(config.attributes.discount).toBe('data-dl-discount');
    expect(config.attributes.coupon).toBe('data-dl-coupon');
    expect(config.attributes.currency).toBe('data-dl-currency');
    expect(config.attributes.transactionId).toBe('data-dl-transaction-id');
  });

  it('has debounceMs and navigationDelay defaults', () => {
    const config = window.ppLib.datalayer.getConfig();
    expect(config.debounceMs).toBe(300);
    expect(config.navigationDelay).toBe(200);
  });
});

// =========================================================================
// 3. USER OBJECT
// =========================================================================
describe('User Object', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('reads userId and patientId from cookies', () => {
    setCookie('userId', '42');
    setCookie('patientId', '99');
    setCookie('app_is_authenticated', 'true');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.pp_user_id).toBe('42');
    expect(event.user.pp_patient_id).toBe('99');
    expect(event.user.logged_in).toBe(true);
  });

  it('derives logged_in = false when userId is empty', () => {
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.pp_user_id).toBe('');
    expect(event.user.logged_in).toBe(false);
  });

  it('derives logged_in = false when userId is "-1"', () => {
    setCookie('userId', '-1');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.pp_user_id).toBe('-1');
    expect(event.user.logged_in).toBe(false);
  });

  it('setUser overrides cookie values', () => {
    setCookie('userId', '42');
    setCookie('patientId', '99');

    window.ppLib.datalayer.setUser({ pp_user_id: 'override-100', logged_in: false });
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.pp_user_id).toBe('override-100');
    expect(event.user.pp_patient_id).toBe('99');
    expect(event.user.logged_in).toBe(false);
  });

  it('setUser with pp_patient_id override', () => {
    window.ppLib.datalayer.setUser({ pp_patient_id: 'pat-500' });
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.pp_patient_id).toBe('pat-500');
  });
});

// =========================================================================
// 3a. logged_in DERIVATION
// =========================================================================
describe('logged_in Derivation', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('logged_in = false when userId missing and appAuth not true', () => {
    setCookie('patientId', '99');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.logged_in).toBe(false);
  });

  it('logged_in = true when only appAuth is true (no userId/patientId)', () => {
    setCookie('app_is_authenticated', 'true');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.logged_in).toBe(true);
  });

  it('logged_in = false when patientId missing and appAuth not true', () => {
    setCookie('userId', '42');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.logged_in).toBe(false);
  });

  it('logged_in = true when userId and patientId exist regardless of appAuth', () => {
    setCookie('userId', '42');
    setCookie('patientId', '99');
    setCookie('app_is_authenticated', 'false');

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user.logged_in).toBe(true);
  });
});

// =========================================================================
// 4. USER DATA / SHA-256
// =========================================================================
describe('User Data / SHA-256', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('hashes raw email, phone, first_name, last_name, street', async () => {
    await window.ppLib.datalayer.setUserData({
      email: 'Test@Example.com',
      phone: '+15551234567',
      first_name: 'John',
      last_name: 'Doe',
      street: '123 Main St'
    });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(await sha256hex('Test@Example.com'));
    expect(event.user_data.sha256_phone_number).toBe(await sha256hex('+15551234567'));
    expect(event.user_data.address.sha256_first_name).toBe(await sha256hex('John'));
    expect(event.user_data.address.sha256_last_name).toBe(await sha256hex('Doe'));
    expect(event.user_data.address.sha256_street).toBe(await sha256hex('123 Main St'));
  });

  it('passes city, region, postal_code, country as plain text', async () => {
    await window.ppLib.datalayer.setUserData({
      city: 'Toronto',
      region: 'ON',
      postal_code: 'M5V 1A1',
      country: 'CA'
    });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.address.city).toBe('Toronto');
    expect(event.user_data.address.region).toBe('ON');
    expect(event.user_data.address.postal_code).toBe('M5V 1A1');
    expect(event.user_data.address.country).toBe('CA');
  });

  it('skips hashing values that already look like SHA-256', async () => {
    const preHashed = 'a'.repeat(64);

    await window.ppLib.datalayer.setUserData({ email: preHashed });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(preHashed);
  });

  it('handles empty/undefined fields gracefully', async () => {
    await window.ppLib.datalayer.setUserData({});

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe('');
    expect(event.user_data.sha256_phone_number).toBe('');
    expect(event.user_data.address.sha256_first_name).toBe('');
  });

  it('produces known SHA-256 digest for "test@test.com"', async () => {
    // Known: SHA-256 of "test@test.com" (already lowercase, no trim needed)
    const expected = await sha256hex('test@test.com');

    await window.ppLib.datalayer.setUserData({ email: 'test@test.com' });
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(expected);
  });

  it('caches user data across multiple pushes', async () => {
    await window.ppLib.datalayer.setUserData({ email: 'cached@test.com', city: 'Vancouver' });

    window.ppLib.datalayer.push('event_1');
    window.ppLib.datalayer.push('event_2');

    const e1 = window.dataLayer[window.dataLayer.length - 2];
    const e2 = window.dataLayer[window.dataLayer.length - 1];
    expect(e1.user_data.sha256_email_address).toBe(e2.user_data.sha256_email_address);
    expect(e1.user_data.address.city).toBe('Vancouver');
    expect(e2.user_data.address.city).toBe('Vancouver');
  });

  it('setUserDataHashed passes pre-hashed values directly', () => {
    const hash = 'b'.repeat(64);
    window.ppLib.datalayer.setUserDataHashed({
      sha256_email_address: hash,
      sha256_phone_number: 'c'.repeat(64),
      address: {
        sha256_first_name: 'd'.repeat(64),
        city: 'Montreal',
        region: 'QC',
        postal_code: 'H2X 1Y4',
        country: 'CA'
      }
    });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(hash);
    expect(event.user_data.sha256_phone_number).toBe('c'.repeat(64));
    expect(event.user_data.address.sha256_first_name).toBe('d'.repeat(64));
    expect(event.user_data.address.city).toBe('Montreal');
    expect(event.user_data.address.region).toBe('QC');
  });

  it('setUserDataHashed handles missing address', () => {
    window.ppLib.datalayer.setUserDataHashed({
      sha256_email_address: 'e'.repeat(64)
    });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe('e'.repeat(64));
    expect(event.user_data.address.sha256_first_name).toBe('');
    expect(event.user_data.address.city).toBe('');
  });

  it('setUserDataHashed with empty object defaults to empty strings', () => {
    window.ppLib.datalayer.setUserDataHashed({});

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe('');
    expect(event.user_data.sha256_phone_number).toBe('');
  });

  it('returns empty hash when crypto.subtle is unavailable (HTTP context)', async () => {
    const origCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);

    await window.ppLib.datalayer.setUserData({ email: 'test@test.com' });
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe('');

    vi.stubGlobal('crypto', origCrypto);
  });
});

// =========================================================================
// 4a. COOKIE AUTO-POPULATE
// =========================================================================
describe('Cookie Auto-populate', () => {
  it('hashes all PII cookies into user_data', async () => {
    setCookie('email', 'alice@example.com');
    setCookie('phone', '+15551234567');
    setCookie('firstName', 'Alice');
    setCookie('lastName', 'Smith');
    setCookie('street', '123 Main St');
    setCookie('city', 'Toronto');
    setCookie('region', 'ON');
    setCookie('postalCode', 'M5V 1A1');
    setCookie('country', 'CA');

    loadWithCommon('datalayer');
    createMockDataLayer();

    // Wait for fire-and-forget setUserData to complete
    await new Promise(r => setTimeout(r, 50));

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(await sha256hex('alice@example.com'));
    expect(event.user_data.sha256_phone_number).toBe(await sha256hex('+15551234567'));
    expect(event.user_data.address.sha256_first_name).toBe(await sha256hex('Alice'));
    expect(event.user_data.address.sha256_last_name).toBe(await sha256hex('Smith'));
    expect(event.user_data.address.sha256_street).toBe(await sha256hex('123 Main St'));
    expect(event.user_data.address.city).toBe('Toronto');
    expect(event.user_data.address.region).toBe('ON');
    expect(event.user_data.address.postal_code).toBe('M5V 1A1');
    expect(event.user_data.address.country).toBe('CA');
  });

  it('returns empty strings when cookies are not set', () => {
    loadWithCommon('datalayer');
    createMockDataLayer();

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe('');
    expect(event.user_data.sha256_phone_number).toBe('');
    expect(event.user_data.address.sha256_first_name).toBe('');
    expect(event.user_data.address.sha256_last_name).toBe('');
    expect(event.user_data.address.sha256_street).toBe('');
    expect(event.user_data.address.city).toBe('');
    expect(event.user_data.address.region).toBe('');
    expect(event.user_data.address.postal_code).toBe('');
    expect(event.user_data.address.country).toBe('');
  });

  it('manual setUserData overrides cookie defaults', async () => {
    setCookie('email', 'alice@example.com');
    setCookie('firstName', 'Alice');
    setCookie('lastName', 'Smith');

    loadWithCommon('datalayer');
    createMockDataLayer();

    // Wait for fire-and-forget to complete
    await new Promise(r => setTimeout(r, 50));

    // Manual override
    await window.ppLib.datalayer.setUserData({ email: 'bob@example.com', first_name: 'Bob', last_name: 'Jones' });
    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user_data.sha256_email_address).toBe(await sha256hex('bob@example.com'));
    expect(event.user_data.address.sha256_first_name).toBe(await sha256hex('Bob'));
    expect(event.user_data.address.sha256_last_name).toBe(await sha256hex('Jones'));
  });
});

// =========================================================================
// 5. PAGE OBJECT
// =========================================================================
describe('Page Object', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('captures url, title, and referrer', () => {
    document.title = 'Test Page';

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.page.url).toBe(window.location.href);
    expect(event.page.title).toBe('Test Page');
    expect(typeof event.page.referrer).toBe('string');
  });

  it('reflects title changes on subsequent pushes', () => {
    document.title = 'First';
    window.ppLib.datalayer.push('event_1');

    document.title = 'Second';
    window.ppLib.datalayer.push('event_2');

    expect(window.dataLayer[window.dataLayer.length - 2].page.title).toBe('First');
    expect(window.dataLayer[window.dataLayer.length - 1].page.title).toBe('Second');
  });

  it('includes referrer from document.referrer', () => {
    Object.defineProperty(document, 'referrer', { value: 'https://google.com', configurable: true });

    window.ppLib.datalayer.push('test_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.page.referrer).toBe('https://google.com');

    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  });
});

// =========================================================================
// 6. ITEM BUILDER
// =========================================================================
describe('Item Builder', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('normalizes items with defaults and null fill', () => {
    window.ppLib.datalayer.viewItem([{ item_name: 'Aspirin' }]);

    // dataLayer: [ecommerce null clear, enriched event]
    const event = window.dataLayer[window.dataLayer.length - 1];
    const item = event.ecommerce.items[0];
    expect(item.item_id).toBeNull();
    expect(item.item_name).toBe('Aspirin');
    expect(item.item_brand).toBe('Pocketpills');
    expect(item.item_category).toBeNull();
    expect(item.price).toBe(0);
    expect(item.quantity).toBe(1);
    expect(item.discount).toBe(0);
    expect(item.coupon).toBeNull();
  });

  it('parses string price and discount', () => {
    window.ppLib.datalayer.viewItem([{ item_id: 'RX-1', price: '29.99', discount: '5.00' }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    const item = event.ecommerce.items[0];
    expect(item.price).toBe(29.99);
    expect(item.discount).toBe(5);
  });

  it('handles NaN price/discount gracefully', () => {
    window.ppLib.datalayer.viewItem([{ price: 'abc', discount: 'xyz' }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    const item = event.ecommerce.items[0];
    expect(item.price).toBe(0);
    expect(item.discount).toBe(0);
  });

  it('uses custom item_brand from input', () => {
    window.ppLib.datalayer.viewItem([{ item_brand: 'CustomBrand' }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    const item = event.ecommerce.items[0];
    expect(item.item_brand).toBe('CustomBrand');
  });

  it('calculates value correctly for single item', () => {
    window.ppLib.datalayer.viewItem([{ price: 100, quantity: 2, discount: 10 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    // (100 * 2) - 10 = 190
    expect(event.ecommerce.value).toBe(190);
  });

  it('calculates value correctly for multiple items', () => {
    window.ppLib.datalayer.viewItem([
      { price: 50, quantity: 2, discount: 5 },
      { price: 30, quantity: 1, discount: 0 }
    ]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    // (50*2 - 5) + (30*1 - 0) = 95 + 30 = 125
    expect(event.ecommerce.value).toBe(125);
  });
});

// =========================================================================
// 7. CORE EVENT PUSH
// =========================================================================
describe('Core Event Push', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('push() creates enriched event on dataLayer', () => {
    window.ppLib.datalayer.push('custom_event', { key: 'value' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('custom_event');
    expect(event.key).toBe('value');
    expect(event.user).toBeDefined();
    expect(event.user_data).toBeDefined();
    expect(event.page).toBeDefined();
    expect(event.pp_timestamp).toBeDefined();
  });

  it('push() does not push to dataLayer when validateData returns false', () => {
    const origValidateData = window.ppLib.Security.validateData;
    window.ppLib.Security.validateData = () => false;

    const lengthBefore = window.dataLayer.length;
    window.ppLib.datalayer.push('rejected_event', { bad: 'data' });
    expect(window.dataLayer.length).toBe(lengthBefore);

    window.ppLib.Security.validateData = origValidateData;
  });

  it('push() without extra data still includes enrichment', () => {
    window.ppLib.datalayer.push('simple_event');

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('simple_event');
    expect(event.user).toBeDefined();
    expect(event.pp_timestamp).toBeDefined();
  });

  it('pageview() adds platform from config', () => {
    window.ppLib.datalayer.pageview();

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('pageview');
    expect(event.platform).toBe('web');
  });

  it('pageview() merges extra data', () => {
    window.ppLib.datalayer.pageview({ page_type: 'home' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('pageview');
    expect(event.platform).toBe('web');
    expect(event.page_type).toBe('home');
  });

  it('loginView() pushes login_view event', () => {
    window.ppLib.datalayer.loginView({ method: 'email' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('login_view');
    expect(event.method).toBe('email');
  });

  it('loginSuccess() forces logged_in = true and pushes login_success', () => {
    window.ppLib.datalayer.loginSuccess({ method: 'email', pp_user_id: '123', pp_patient_id: '456' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('login_success');
    expect(event.method).toBe('email');
    expect(event.user.logged_in).toBe(true);
    expect(event.user.pp_user_id).toBe('123');
    expect(event.user.pp_patient_id).toBe('456');
  });

  it('loginSuccess() without optional IDs still forces logged_in', () => {
    window.ppLib.datalayer.loginSuccess({ method: 'google' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('login_success');
    expect(event.user.logged_in).toBe(true);
  });

  it('signupView() pushes signup_view event', () => {
    window.ppLib.datalayer.signupView({ method: 'email', signup_flow: 'onboarding' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('signup_view');
    expect(event.method).toBe('email');
    expect(event.signup_flow).toBe('onboarding');
  });

  it('signupStart() pushes signup_start event', () => {
    window.ppLib.datalayer.signupStart({ method: 'phone' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('signup_start');
    expect(event.method).toBe('phone');
  });

  it('signupComplete() forces logged_in = true with optional IDs', () => {
    window.ppLib.datalayer.signupComplete({ method: 'email', pp_user_id: '789', pp_patient_id: '012' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('signup_complete');
    expect(event.method).toBe('email');
    expect(event.user.logged_in).toBe(true);
    expect(event.user.pp_user_id).toBe('789');
    expect(event.user.pp_patient_id).toBe('012');
  });

  it('signupComplete() without optional IDs still forces logged_in', () => {
    window.ppLib.datalayer.signupComplete({ method: 'google' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('signup_complete');
    expect(event.user.logged_in).toBe(true);
  });

  it('search() pushes search event with all fields', () => {
    window.ppLib.datalayer.search({ search_term: 'aspirin', results_count: 5, search_type: 'product' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('search');
    expect(event.search_term).toBe('aspirin');
    expect(event.results_count).toBe(5);
    expect(event.search_type).toBe('product');
  });
});

// =========================================================================
// 8. ECOMMERCE PUSH
// =========================================================================
describe('Ecommerce Push', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('clears previous ecommerce data before push', () => {
    window.ppLib.datalayer.viewItem([{ item_name: 'Test' }]);

    // First push is the null clear, second is the enriched event
    expect(window.dataLayer[0]).toEqual({ ecommerce: null });
  });

  it('viewItem pushes view_item with items and value', () => {
    window.ppLib.datalayer.viewItem([{ item_id: 'RX-1', item_name: 'Aspirin', price: 10 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('view_item');
    expect(event.ecommerce.items).toHaveLength(1);
    expect(event.ecommerce.items[0].item_id).toBe('RX-1');
    expect(event.ecommerce.value).toBe(10);
    expect(event.ecommerce.currency).toBe('CAD');
  });

  it('addToCart pushes add_to_cart event', () => {
    window.ppLib.datalayer.addToCart([{ item_id: 'RX-2', price: 20, quantity: 3 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('add_to_cart');
    expect(event.ecommerce.items[0].quantity).toBe(3);
    expect(event.ecommerce.value).toBe(60);
  });

  it('beginCheckout pushes begin_checkout event', () => {
    window.ppLib.datalayer.beginCheckout([{ item_id: 'RX-3', price: 50 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('begin_checkout');
    expect(event.ecommerce.items).toHaveLength(1);
  });

  it('addPaymentInfo pushes add_payment_info event', () => {
    window.ppLib.datalayer.addPaymentInfo([{ item_id: 'RX-4', price: 75 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('add_payment_info');
    expect(event.ecommerce.items).toHaveLength(1);
  });

  it('purchase adds transaction_id to event', () => {
    window.ppLib.datalayer.purchase('TXN-001', [{ item_id: 'RX-5', price: 100 }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('purchase');
    expect(event.transaction_id).toBe('TXN-001');
    expect(event.ecommerce.items).toHaveLength(1);
    expect(event.ecommerce.value).toBe(100);
  });

  it('pushEcommerce supports generic ecommerce events with extra data', () => {
    window.ppLib.datalayer.pushEcommerce('remove_from_cart', [{ item_id: 'RX-6', price: 15 }], { list_name: 'cart' });

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('remove_from_cart');
    expect(event.list_name).toBe('cart');
    expect(event.ecommerce.items).toHaveLength(1);
  });

  it('ecommerce push includes user, user_data, page, timestamp', () => {
    setCookie('userId', '42');
    window.ppLib.datalayer.viewItem([{ item_name: 'Test' }]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.user).toBeDefined();
    expect(event.user.pp_user_id).toBe('42');
    expect(event.user_data).toBeDefined();
    expect(event.page).toBeDefined();
    expect(event.pp_timestamp).toBeDefined();
  });
});

// =========================================================================
// 9. DOM BINDING — CORE EVENTS
// =========================================================================
describe('DOM Binding — Core Events', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('pushes pageview event with platform from data-dl-event click', () => {
    createDataLayerDOM([
      { event: 'pageview', attrs: { 'data-dl-page-type': 'home' } }
    ]);

    const btn = document.querySelector('[data-dl-event="pageview"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('pageview');
    expect(event.platform).toBe('web');
    expect(event.page_type).toBe('home');
  });

  it('pushes login_view event with method', () => {
    createDataLayerDOM([
      { event: 'login_view', attrs: { 'data-dl-method': 'email' } }
    ]);

    const btn = document.querySelector('[data-dl-event="login_view"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('login_view');
    expect(event.method).toBe('email');
  });

  it('pushes login_success event with method', () => {
    createDataLayerDOM([
      { event: 'login_success', attrs: { 'data-dl-method': 'google' } }
    ]);

    const btn = document.querySelector('[data-dl-event="login_success"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('login_success');
    expect(event.method).toBe('google');
  });

  it('pushes signup_view event with method and signup_flow', () => {
    createDataLayerDOM([
      { event: 'signup_view', attrs: { 'data-dl-method': 'email', 'data-dl-signup-flow': 'onboarding' } }
    ]);

    const btn = document.querySelector('[data-dl-event="signup_view"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('signup_view');
    expect(event.method).toBe('email');
    expect(event.signup_flow).toBe('onboarding');
  });

  it('pushes search event with search_term, results_count, search_type', () => {
    createDataLayerDOM([
      { event: 'search', attrs: { 'data-dl-search-term': 'aspirin', 'data-dl-results-count': '5', 'data-dl-search-type': 'product' } }
    ]);

    const btn = document.querySelector('[data-dl-event="search"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('search');
    expect(event.search_term).toBe('aspirin');
    expect(event.results_count).toBe(5);
    expect(event.search_type).toBe('product');
  });
});

// =========================================================================
// 10. DOM BINDING — ECOMMERCE EVENTS
// =========================================================================
describe('DOM Binding — Ecommerce Events', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('pushes view_item from data-dl-event with item attributes', () => {
    createDataLayerDOM([
      { event: 'view_item', attrs: { 'data-dl-item-id': 'RX-1', 'data-dl-item-name': 'Aspirin', 'data-dl-item-price': '10.99' } }
    ]);

    const btn = document.querySelector('[data-dl-event="view_item"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('view_item');
    expect(event.ecommerce.items).toHaveLength(1);
    expect(event.ecommerce.items[0].item_id).toBe('RX-1');
    expect(event.ecommerce.items[0].item_name).toBe('Aspirin');
    expect(event.ecommerce.items[0].price).toBe(10.99);
  });

  it('pushes add_to_cart from data-dl-event with quantity and discount', () => {
    createDataLayerDOM([
      { event: 'add_to_cart', attrs: { 'data-dl-item-id': 'RX-2', 'data-dl-item-price': '20', 'data-dl-quantity': '3', 'data-dl-discount': '5' } }
    ]);

    const btn = document.querySelector('[data-dl-event="add_to_cart"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('add_to_cart');
    expect(event.ecommerce.items[0].quantity).toBe(3);
    expect(event.ecommerce.items[0].discount).toBe(5);
  });

  it('pushes purchase with transaction_id from data-dl-transaction-id', () => {
    createDataLayerDOM([
      { event: 'purchase', attrs: { 'data-dl-item-id': 'RX-3', 'data-dl-item-price': '100', 'data-dl-transaction-id': 'TXN-DOM-1' } }
    ]);

    const btn = document.querySelector('[data-dl-event="purchase"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('purchase');
    expect(event.transaction_id).toBe('TXN-DOM-1');
    expect(event.ecommerce.items).toHaveLength(1);
  });

  it('resolves item data from container ancestor (container pattern)', () => {
    // Container div has item data, child button triggers event
    const container = document.createElement('div');
    container.setAttribute('data-dl-item-id', 'RX-CONTAINER');
    container.setAttribute('data-dl-item-name', 'Container Med');
    container.setAttribute('data-dl-item-price', '55');

    const btn = document.createElement('button');
    btn.setAttribute('data-dl-event', 'add_to_cart');
    container.appendChild(btn);
    document.body.appendChild(container);

    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('add_to_cart');
    expect(event.ecommerce.items[0].item_id).toBe('RX-CONTAINER');
    expect(event.ecommerce.items[0].item_name).toBe('Container Med');
    expect(event.ecommerce.items[0].price).toBe(55);
  });
});

// =========================================================================
// 11. DOM BINDING — ANCHOR hitCallback
// =========================================================================
describe('DOM Binding — Anchor hitCallback', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('calls preventDefault on anchor click and pushes event', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/page';
    anchor.setAttribute('data-dl-event', 'login_view');
    anchor.setAttribute('data-dl-method', 'link');
    document.body.appendChild(anchor);

    const clickEvent = new Event('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);

    const dlEvent = window.dataLayer[window.dataLayer.length - 1];
    expect(dlEvent.event).toBe('login_view');
    expect(dlEvent.method).toBe('link');
  });

  it('navigates to href after delay', async () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/delayed';
    anchor.setAttribute('data-dl-event', 'signup_start');
    anchor.setAttribute('data-dl-method', 'email');
    document.body.appendChild(anchor);

    // Spy on location.href assignment
    const originalHref = window.location.href;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: originalHref, set href(val: string) { hrefSpy(val); } },
      writable: true,
      configurable: true
    });
    // Re-define href as a setter
    Object.defineProperty(window.location, 'href', {
      get: () => originalHref,
      set: hrefSpy,
      configurable: true
    });

    anchor.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    // Not navigated immediately
    expect(hrefSpy).not.toHaveBeenCalled();

    // Wait for navigationDelay (200ms) + buffer
    await new Promise(r => setTimeout(r, 250));

    expect(hrefSpy).toHaveBeenCalledWith('https://example.com/delayed');
  });

  it('opens new tab for target="_blank" anchors after delay', async () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/new-tab';
    anchor.target = '_blank';
    anchor.setAttribute('data-dl-event', 'login_view');
    anchor.setAttribute('data-dl-method', 'link');
    document.body.appendChild(anchor);

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => ({} as Window));

    anchor.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    // Not opened immediately
    expect(openSpy).not.toHaveBeenCalled();

    // Wait for navigationDelay (200ms) + buffer
    await new Promise(r => setTimeout(r, 250));

    expect(openSpy).toHaveBeenCalledWith('https://example.com/new-tab', '_blank', 'noopener');
    openSpy.mockRestore();
  });

  it('falls back to location.href when popup is blocked (window.open returns null)', async () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/blocked';
    anchor.target = '_blank';
    anchor.setAttribute('data-dl-event', 'login_view');
    document.body.appendChild(anchor);

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const originalHref = window.location.href;
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: originalHref },
      writable: true,
      configurable: true
    });
    Object.defineProperty(window.location, 'href', {
      get: () => originalHref,
      set: hrefSpy,
      configurable: true
    });

    anchor.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    await new Promise(r => setTimeout(r, 250));

    expect(openSpy).toHaveBeenCalled();
    expect(hrefSpy).toHaveBeenCalledWith('https://example.com/blocked');
    openSpy.mockRestore();
  });

  it('does not call preventDefault on non-anchor elements', () => {
    createDataLayerDOM([
      { event: 'test_click', tag: 'button' }
    ]);

    const btn = document.querySelector('[data-dl-event="test_click"]')!;
    const clickEvent = new Event('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(false);
  });
});

// =========================================================================
// 12. DOM BINDING — DEBOUNCE
// =========================================================================
describe('DOM Binding — Debounce', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('rapid clicks on same element produce only one push', () => {
    createDataLayerDOM([
      { event: 'rapid_test', tag: 'button', id: 'debounce-btn' }
    ]);

    const btn = document.querySelector('#debounce-btn')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    btn.dispatchEvent(new Event('click', { bubbles: true }));
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const pushes = window.dataLayer.filter(e => e.event === 'rapid_test');
    expect(pushes).toHaveLength(1);
  });

  it('different elements produce separate pushes', () => {
    createDataLayerDOM([
      { event: 'click_a', tag: 'button', id: 'btn-a' },
      { event: 'click_b', tag: 'button', id: 'btn-b' }
    ]);

    document.querySelector('#btn-a')!.dispatchEvent(new Event('click', { bubbles: true }));
    document.querySelector('#btn-b')!.dispatchEvent(new Event('click', { bubbles: true }));

    const pushA = window.dataLayer.filter(e => e.event === 'click_a');
    const pushB = window.dataLayer.filter(e => e.event === 'click_b');
    expect(pushA).toHaveLength(1);
    expect(pushB).toHaveLength(1);
  });
});

// =========================================================================
// 13. DOM BINDING — EVENT DELEGATION
// =========================================================================
describe('DOM Binding — Event Delegation', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('child click bubbles to data-dl-event element', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-dl-event', 'wrapper_click');
    wrapper.setAttribute('data-dl-method', 'bubble');

    const child = document.createElement('span');
    child.textContent = 'Click me';
    wrapper.appendChild(child);
    document.body.appendChild(wrapper);

    child.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('wrapper_click');
    expect(event.method).toBe('bubble');
  });

  it('unrelated element click does not push', () => {
    const unrelated = document.createElement('button');
    unrelated.textContent = 'No event';
    document.body.appendChild(unrelated);

    const before = window.dataLayer.length;
    unrelated.dispatchEvent(new Event('click', { bubbles: true }));

    expect(window.dataLayer.length).toBe(before);
  });

  it('touchend event fires same as click', () => {
    createDataLayerDOM([
      { event: 'touch_test', tag: 'button', id: 'touch-btn' }
    ]);

    const btn = document.querySelector('#touch-btn')!;
    btn.dispatchEvent(new Event('touchend', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('touch_test');
  });
});

// =========================================================================
// 14. DOM BINDING — ERROR HANDLING
// =========================================================================
describe('DOM Binding — Error Handling', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
    window.ppLib.datalayer.init();
  });

  it('catches and logs errors during interaction handling', () => {
    const logSpy = vi.spyOn(window.ppLib, 'log');

    // Create element with data-dl-event but sabotage Security.sanitize to throw
    createDataLayerDOM([{ event: 'error_test' }]);
    const originalSanitize = window.ppLib.Security.sanitize;
    window.ppLib.Security.sanitize = () => { throw new Error('test error'); };

    const btn = document.querySelector('[data-dl-event="error_test"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    expect(logSpy).toHaveBeenCalledWith('error', '[ppDataLayer] handleInteraction error', expect.any(Error));

    window.ppLib.Security.sanitize = originalSanitize;
    logSpy.mockRestore();
  });
});

// =========================================================================
// 15. API: init / bindDOM
// =========================================================================
describe('API: init / bindDOM', () => {
  it('init and bindDOM are both exposed and functional', () => {
    loadWithCommon('datalayer');

    expect(typeof window.ppLib.datalayer.init).toBe('function');
    expect(typeof window.ppLib.datalayer.bindDOM).toBe('function');
  });

  it('bindDOM re-binds DOM listeners', () => {
    loadWithCommon('datalayer');
    createMockDataLayer();

    // Call bindDOM explicitly
    window.ppLib.datalayer.bindDOM();

    createDataLayerDOM([{ event: 'bind_test' }]);
    const btn = document.querySelector('[data-dl-event="bind_test"]')!;
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('bind_test');
  });
});

// =========================================================================
// 16. INTEGRATION
// =========================================================================
describe('Integration', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('full enriched event includes all context fields', async () => {
    setCookie('userId', '100');
    setCookie('patientId', '200');
    setCookie('app_is_authenticated', 'true');
    document.title = 'Integration Test';

    await window.ppLib.datalayer.setUserData({ email: 'int@test.com', city: 'Toronto' });
    window.ppLib.datalayer.push('full_test', { custom: true });

    const event = window.dataLayer[window.dataLayer.length - 1];

    // Event
    expect(event.event).toBe('full_test');
    expect(event.custom).toBe(true);

    // User
    expect(event.user.pp_user_id).toBe('100');
    expect(event.user.pp_patient_id).toBe('200');
    expect(event.user.logged_in).toBe(true);

    // User data
    expect(event.user_data.sha256_email_address).toBe(await sha256hex('int@test.com'));
    expect(event.user_data.address.city).toBe('Toronto');

    // Page
    expect(event.page.title).toBe('Integration Test');
    expect(event.page.url).toBeTruthy();

    // Timestamp
    expect(event.pp_timestamp).toBeTruthy();
    // ISO 8601 format
    expect(() => new Date(event.pp_timestamp)).not.toThrow();
  });

  it('ecommerce purchase with full user context', () => {
    setCookie('userId', '55');
    setCookie('patientId', '66');
    setCookie('app_is_authenticated', 'true');
    window.ppLib.datalayer.setUserDataHashed({ sha256_email_address: 'f'.repeat(64) });

    window.ppLib.datalayer.purchase('TXN-INT', [
      { item_id: 'RX-A', item_name: 'Med A', price: 50, quantity: 2 },
      { item_id: 'RX-B', item_name: 'Med B', price: 30 }
    ]);

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('purchase');
    expect(event.transaction_id).toBe('TXN-INT');
    expect(event.user.pp_user_id).toBe('55');
    expect(event.user.logged_in).toBe(true);
    expect(event.user_data.sha256_email_address).toBe('f'.repeat(64));
    expect(event.ecommerce.items).toHaveLength(2);
    // (50*2 - 0) + (30*1 - 0) = 130
    expect(event.ecommerce.value).toBe(130);
    expect(event.ecommerce.currency).toBe('CAD');
  });

  it('initializes dataLayer if not present', () => {
    delete window.dataLayer;

    window.ppLib.datalayer.push('init_test');

    expect(Array.isArray(window.dataLayer)).toBe(true);
    expect(window.dataLayer.length).toBe(1);
    expect(window.dataLayer[0].event).toBe('init_test');
  });
});

// =========================================================================
// 17. AUTO VIEW_ITEM ON PAGE LOAD
// =========================================================================
describe('Auto view_item on page load', () => {
  beforeEach(() => {
    loadWithCommon('datalayer');
    createMockDataLayer();
  });

  it('config defaults autoViewItem to true', () => {
    const config = window.ppLib.datalayer.getConfig();
    expect(config.autoViewItem).toBe(true);
  });

  it('scanViewItems is exposed as a function on the API', () => {
    expect(typeof window.ppLib.datalayer.scanViewItems).toBe('function');
  });

  it('auto-fires view_item when data-dl-view-item elements exist in DOM', () => {
    const el = document.createElement('div');
    el.setAttribute('data-dl-view-item', '');
    el.setAttribute('data-dl-item-id', 'SKU-100');
    el.setAttribute('data-dl-item-name', 'Test Drug');
    el.setAttribute('data-dl-item-price', '25.99');
    document.body.appendChild(el);

    const before = window.dataLayer.length;
    window.ppLib.datalayer.scanViewItems();

    // pushEcommerceEvent pushes { ecommerce: null } clear + the enriched event
    expect(window.dataLayer.length).toBe(before + 2);
    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('view_item');
    expect(event.ecommerce.items).toHaveLength(1);
    expect(event.ecommerce.items[0].item_id).toBe('SKU-100');
    expect(event.ecommerce.items[0].item_name).toBe('Test Drug');
    expect(event.ecommerce.items[0].price).toBe(25.99);
  });

  it('does not fire view_item when no data-dl-view-item elements exist', () => {
    // No view-item elements in DOM (even if item-id exists without view-item marker)
    const el = document.createElement('div');
    el.setAttribute('data-dl-item-id', 'SKU-CART');
    document.body.appendChild(el);

    const before = window.dataLayer.length;
    window.ppLib.datalayer.scanViewItems();
    expect(window.dataLayer.length).toBe(before);
  });

  it('collects multiple items from DOM', () => {
    const items = [
      { id: 'SKU-1', name: 'Drug A', price: '10' },
      { id: 'SKU-2', name: 'Drug B', price: '20' },
      { id: 'SKU-3', name: 'Drug C', price: '30' }
    ];
    items.forEach(item => {
      const el = document.createElement('div');
      el.setAttribute('data-dl-view-item', '');
      el.setAttribute('data-dl-item-id', item.id);
      el.setAttribute('data-dl-item-name', item.name);
      el.setAttribute('data-dl-item-price', item.price);
      document.body.appendChild(el);
    });

    const before = window.dataLayer.length;
    window.ppLib.datalayer.scanViewItems();

    // pushEcommerceEvent pushes { ecommerce: null } clear + the enriched event
    expect(window.dataLayer.length).toBe(before + 2);
    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('view_item');
    expect(event.ecommerce.items).toHaveLength(3);
    expect(event.ecommerce.items[0].item_id).toBe('SKU-1');
    expect(event.ecommerce.items[1].item_id).toBe('SKU-2');
    expect(event.ecommerce.items[2].item_id).toBe('SKU-3');
  });

  it('matches elements by data-dl-item-name only', () => {
    const el = document.createElement('div');
    el.setAttribute('data-dl-view-item', '');
    el.setAttribute('data-dl-item-name', 'Name-Only Drug');
    document.body.appendChild(el);

    window.ppLib.datalayer.scanViewItems();

    const event = window.dataLayer[window.dataLayer.length - 1];
    expect(event.event).toBe('view_item');
    expect(event.ecommerce.items).toHaveLength(1);
    expect(event.ecommerce.items[0].item_name).toBe('Name-Only Drug');
  });

  it('skips view-item elements with neither item_id nor item_name values', () => {
    // Element has data-dl-view-item but no item data
    const el = document.createElement('div');
    el.setAttribute('data-dl-view-item', '');
    document.body.appendChild(el);

    const before = window.dataLayer.length;
    window.ppLib.datalayer.scanViewItems();
    expect(window.dataLayer.length).toBe(before);
  });

  it('catches and logs errors in scanViewItems', () => {
    const logSpy = vi.spyOn(window.ppLib, 'log');

    // Add item element then sabotage querySelectorAll to throw
    const el = document.createElement('div');
    el.setAttribute('data-dl-item-id', 'SKU-ERR');
    document.body.appendChild(el);

    const original = document.querySelectorAll;
    document.querySelectorAll = () => { throw new Error('scan error'); };

    window.ppLib.datalayer.scanViewItems();

    expect(logSpy).toHaveBeenCalledWith('error', '[ppDataLayer] scanViewItems error', expect.any(Error));

    document.querySelectorAll = original;
    logSpy.mockRestore();
  });

  it('autoViewItem can be disabled via configure', () => {
    window.ppLib.datalayer.configure({ autoViewItem: false });
    const config = window.ppLib.datalayer.getConfig();
    expect(config.autoViewItem).toBe(false);
  });
});
