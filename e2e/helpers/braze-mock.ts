import { Page } from '@playwright/test';

/**
 * Intercepts the Braze CDN request via page.route() and injects a mock
 * window.braze object that records all calls for assertion.
 */
export async function mockBrazeCDN(page: Page) {
  await page.route('**/js.appboycdn.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (function() {
          var calls = [];
          var userAttrs = {};
          var customAttrs = {};

          var mockUser = {
            setEmail: function(v) { userAttrs.email = v; calls.push(['setEmail', v]); },
            setFirstName: function(v) { userAttrs.first_name = v; calls.push(['setFirstName', v]); },
            setLastName: function(v) { userAttrs.last_name = v; calls.push(['setLastName', v]); },
            setPhoneNumber: function(v) { userAttrs.phone = v; calls.push(['setPhoneNumber', v]); },
            setGender: function(v) { userAttrs.gender = v; calls.push(['setGender', v]); },
            setDateOfBirth: function(v) { userAttrs.dob = v; calls.push(['setDateOfBirth', v]); },
            setCountry: function(v) { userAttrs.country = v; calls.push(['setCountry', v]); },
            setHomeCity: function(v) { userAttrs.city = v; calls.push(['setHomeCity', v]); },
            setLanguage: function(v) { userAttrs.language = v; calls.push(['setLanguage', v]); },
            setCustomUserAttribute: function(k, v) { customAttrs[k] = v; calls.push(['setCustomUserAttribute', k, v]); }
          };

          window.braze = {
            initialize: function(apiKey, opts) { calls.push(['initialize', apiKey, opts]); },
            openSession: function() { calls.push(['openSession']); },
            changeUser: function(id) { calls.push(['changeUser', id]); },
            logCustomEvent: function(name, props) { calls.push(['logCustomEvent', name, props]); },
            logPurchase: function(id, price, cur, qty, props) { calls.push(['logPurchase', id, price, cur, qty, props]); },
            requestImmediateDataFlush: function() { calls.push(['requestImmediateDataFlush']); },
            getUser: function() { return mockUser; },
            _calls: calls,
            _userAttrs: userAttrs,
            _customAttrs: customAttrs,
            _mockUser: mockUser
          };
        })();
      `
    });
  });
}

/** Retrieve all recorded mock calls from the page. */
export async function getBrazeCalls(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).braze._calls || []);
}

/** Retrieve standard user attributes set via dedicated setters. */
export async function getBrazeUserAttrs(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as any).braze._userAttrs || {});
}

/** Retrieve custom user attributes set via setCustomUserAttribute. */
export async function getBrazeCustomAttrs(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as any).braze._customAttrs || {});
}
