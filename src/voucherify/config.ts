import type { VoucherifyConfig } from '../types/voucherify.types';

export function createVoucherifyConfig(): VoucherifyConfig {
  return {
    api: {
      applicationId: '',
      clientSecretKey: '',
      baseUrl: 'https://as1.api.voucherify.io',
      origin: ''
    },
    cache: {
      enabled: false,
      baseUrl: '/api/voucherify',
      ttl: 300000
    },
    pricing: {
      autoFetch: true,
      productAttribute: 'data-voucherify-product',
      originalPriceAttribute: 'data-voucherify-original-price',
      discountedPriceAttribute: 'data-voucherify-discounted-price',
      discountLabelAttribute: 'data-voucherify-discount-label',
      priceAttribute: 'data-voucherify-base-price',
      currencySymbol: '$',
      currency: 'CAD',
      locale: 'en-CA'
    },
    context: {
      customerSourceIdCookie: 'userId',
      includeUtmParams: true,
      includeLoginState: true
    },
    consent: {
      required: false,
      mode: 'analytics',
      checkFunction: function() { return true; }
    }
  };
}
