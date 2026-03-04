import { Page } from '@playwright/test';

/**
 * Intercepts Voucherify API calls via page.route() and returns mock responses.
 * Tracks all requests for assertion.
 */
export async function mockVoucherifyAPI(page: Page, responses?: {
  qualifications?: any;
  validations?: any;
}) {
  const defaultQualifications = {
    qualifications: [
      {
        id: 'voucher-25-off',
        campaign: 'Test Campaign',
        result: { discount: { type: 'PERCENT', percent_off: 25 } }
      }
    ],
    total: 1,
    has_more: false
  };

  const defaultValidations = {
    redeemables: [{
      status: 'APPLICABLE',
      id: 'TESTCODE',
      result: {
        discount: { type: 'PERCENT', percent_off: 25 },
        order: { amount: 6000, discount_amount: 1500, total_amount: 4500 }
      }
    }]
  };

  await page.route('**/api.voucherify.io/client/v1/qualifications', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses?.qualifications ?? defaultQualifications)
    });
  });

  await page.route('**/api.voucherify.io/client/v1/validations', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses?.validations ?? defaultValidations)
    });
  });

  // Also intercept backend cache route for cache mode testing
  await page.route('**/api/voucherify/qualifications', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses?.qualifications ?? defaultQualifications)
    });
  });

  await page.route('**/api/voucherify/validations', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses?.validations ?? defaultValidations)
    });
  });
}

