/**
 * pp-analytics-lib: Voucherify Module
 * Readonly pricing integration — qualifications, validation, DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.voucherify
 */
import type { PPLib } from '@src/types/common.types';
import type { VoucherifyConfig, ValidationContext, QualificationContext, PricingResult, ValidationResult, QualificationResult, DOMProduct, OffersResult, OfferCategory, FetchOffersOptions, VoucherifyRedeemable, VoucherifyApiResponse, CustomerMetadata } from '@src/types/voucherify.types';
import type { DeepPartial } from '@src/types/utility.types';
import { VoucherifyApiError } from '@src/voucherify/errors';
import { bootstrapModule } from '@src/common/bootstrap';
import { checkModuleConsent } from '@src/common/consent-gate';
import { createPriceFormatter, type PriceFormatter } from '@src/voucherify/formatters';
import { createVoucherifyApiClient } from '@src/voucherify/api-client';
import {
  scanProductsFromDOM,
  removeCloakAttribute as removeCloakAttributeHelper,
  addLoadingClass as addLoadingClassHelper,
  removeLoadingClass as removeLoadingClassHelper,
} from '@src/voucherify/dom';
import { createSegmentResolver } from '@src/voucherify/segment-resolver';
import { createPricingEngine } from '@src/voucherify/pricing-engine';
import { createOffersManager } from '@src/voucherify/offers-manager';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VoucherifyConfig = {
    api: {
      applicationId: '',
      clientPublicKey: '',
      clientSecretKey: '',
      // Voucherify regional endpoint. `as1.` (Asia-Singapore) is the
      // production region for Pocketpills' tenant — DO NOT change this to
      // the global `api.voucherify.io` or `us1.` / `eu1.` subdomains
      // without coordinating a tenant migration. Overridable per-deploy
      // via `ppLib.voucherify.configure({ api: { baseUrl: '...' } })`.
      baseUrl: 'https://as1.api.voucherify.io',
      origin: ''
    },
    cache: {
      enabled: false,
      baseUrl: '/api/voucherify',
      ttl: 300000
    },
    edge: {
      mode: 'direct',
      edgeUrl: ''
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
    offers: {
      autoFetch: false,
      containerAttribute: 'data-voucherify-offers',
      templateAttribute: 'data-voucherify-offer-template',
      offerTitleAttribute: 'data-voucherify-offer-title',
      offerDescriptionAttribute: 'data-voucherify-offer-description',
      offerCodeAttribute: 'data-voucherify-offer-code',
      offerDiscountAttribute: 'data-voucherify-offer-discount',
      offerCategoryAttribute: 'data-voucherify-offer-category',
      offerLoyaltyBalanceAttribute: 'data-voucherify-offer-loyalty-balance',
      offerGiftBalanceAttribute: 'data-voucherify-offer-gift-balance',
      emptyStateAttribute: 'data-voucherify-offers-empty',
      categories: ['coupon', 'promotion', 'loyalty', 'referral', 'gift'] as OfferCategory[],
      maxPerCategory: 10,
      personalizeForMember: false
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
    },
    retry: {
      maxRetries: 2,
      baseDelay: 500,
      requestTimeoutMs: 8000
    },
    segments: {
      rules: [],
      cookieName: 'pp_segment',
      cookieMaxAgeMinutes: 30,
      prioritizeOverMember: false
    }
  };

  // =====================================================
  // API CLIENT (extracted to ./api-client.ts)
  // =====================================================

  const apiClient = createVoucherifyApiClient(win, ppLib, CONFIG);
  const apiQualifications = apiClient.apiQualifications;
  const apiValidations = apiClient.apiValidations;
  const fetchWithRetry = apiClient.fetchWithRetry;

  function clearCache(): void {
    apiClient.clearCache();
  }

  // =====================================================
  // SHARED HELPERS (used by pricing + offers + validateVoucher)
  // =====================================================

  /**
   * Extracts the redeemables array from a polymorphic Voucherify API response.
   * Handles 3 response shapes:
   *   1. { qualifications: [...] } (direct array)
   *   2. { redeemables: { data: [...] } } (nested with data)
   *   3. { qualifications: { data: [...] } } (nested qualifications)
   */
  function extractRedeemables(response: VoucherifyApiResponse): VoucherifyRedeemable[] {
    const raw = (response && response.qualifications) || (response && response.redeemables) || [];
    if (Array.isArray(raw)) return raw as VoucherifyRedeemable[];
    return ((raw as { data: VoucherifyRedeemable[] }).data || []);
  }

  function buildCustomer(): { source_id: string; metadata?: CustomerMetadata } | undefined {
    const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (!sourceId) return undefined;

    const customer: { source_id: string; metadata?: CustomerMetadata } = { source_id: ppLib.Security.sanitize(sourceId) };
    const metadata: CustomerMetadata = {};

    if (CONFIG.context.includeLoginState) {
      metadata.is_logged_in = !!(ppLib.login && ppLib.login.isLoggedIn());
    }

    if (CONFIG.context.includeUtmParams) {
      const url = win.location.href;
      const utmParams = ['utm_source', 'utm_medium', 'utm_campaign'];
      for (let i = 0; i < utmParams.length; i++) {
        const val = ppLib.getQueryParam(url, utmParams[i]);
        if (val) metadata[utmParams[i]] = ppLib.Security.sanitize(val);
      }
    }

    // Include rule-resolved segment key in customer metadata
    const ruleSegment = resolveSegmentFromRules();
    if (ruleSegment) {
      metadata.pp_segment = ruleSegment;

      // If the segment is an ad_source segment, also set ad_source metadata
      // so Voucherify validation rules can match on it
      if (ruleSegment.indexOf('ad_source:') === 0) {
        metadata.ad_source = ruleSegment.slice('ad_source:'.length);
      }
    }

    customer.metadata = metadata;
    return customer;
  }

  function getProductsFromDOM(): DOMProduct[] {
    return scanProductsFromDOM(doc, ppLib, CONFIG);
  }

  // Formatter is rebuilt on configure() when locale/currency change.
  // Stored as a let-binding so reconfigure can swap it. The factories
  // read it through getFormatter() so they see the latest reference.
  let formatter: PriceFormatter = createPriceFormatter(CONFIG.pricing);
  function getFormatter(): PriceFormatter { return formatter; }

  // =====================================================
  // SEGMENT RESOLUTION (extracted to ./segment-resolver.ts)
  // =====================================================
  const segmentResolver = createSegmentResolver(win, doc, ppLib, CONFIG);
  const determineSegment = segmentResolver.determineSegment;
  const resolveSegmentFromRules = segmentResolver.resolveSegmentFromRules;

  // =====================================================
  // PRICING ENGINE (extracted to ./pricing-engine.ts)
  // =====================================================
  const pricingEngine = createPricingEngine({
    win,
    doc,
    ppLib,
    CONFIG,
    getFormatter,
    apiQualifications,
    determineSegment,
    buildCustomer,
    extractRedeemables,
    getProductsFromDOM,
    removeCloakAttribute: function() { removeCloakAttributeHelper(doc); },
    addLoadingClass: function(products: DOMProduct[]) { addLoadingClassHelper(products); },
    removeLoadingClass: function(products: DOMProduct[]) { removeLoadingClassHelper(products); },
  });
  const fetchPricing = pricingEngine.fetchPricing;

  // =====================================================
  // OFFERS MANAGER (extracted to ./offers-manager.ts)
  // =====================================================
  const offersManager = createOffersManager({
    win,
    doc,
    ppLib,
    CONFIG,
    getFormatter,
    apiQualifications,
    fetchWithRetry,
    determineSegment,
    buildCustomer,
    extractRedeemables,
  });
  const fetchOffers = offersManager.fetchOffers;

  // =====================================================
  // EDGE PROXY HELPERS (validateVoucher / checkQualifications)
  // =====================================================

  async function edgeValidateVoucher(code: string, body: Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const response = await win.fetch(CONFIG.edge.edgeUrl + '/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new VoucherifyApiError('Edge validate non-OK', { endpoint: '/api/validate', status: response.status });
    return response.json() as Promise<VoucherifyApiResponse>;
  }

  async function edgeCheckQualifications(body: Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const response = await win.fetch(CONFIG.edge.edgeUrl + '/api/qualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new VoucherifyApiError('Edge qualify non-OK', { endpoint: '/api/qualify', status: response.status });
    return response.json() as Promise<VoucherifyApiResponse>;
  }


  // =====================================================
  // CONSENT CHECK
  // =====================================================

  function hasConsent(): boolean {
    return checkModuleConsent(CONFIG.consent, { win, ppLib, logPrefix: '[ppVoucherify]' });
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  let initialized = false;

  function init(): void {
    if (initialized) return;

    if (!CONFIG.api.applicationId && !CONFIG.cache.enabled && CONFIG.edge.mode !== 'edge' && CONFIG.edge.mode !== 'cms') {
      ppLib.log('warn', '[ppVoucherify] No applicationId configured and cache not enabled. Call ppLib.voucherify.configure() before init.');
      return;
    }

    if (CONFIG.cache.enabled && !CONFIG.cache.baseUrl) {
      ppLib.log('warn', '[ppVoucherify] Cache enabled but cache.baseUrl is empty. Provide a cache proxy URL.');
      return;
    }

    // Consent gate
    if (!hasConsent()) {
      ppLib.log('info', '[ppVoucherify] Consent not granted — module not initialized');
      return;
    }

    // Hard-block credential exposure in any browser-direct mode. The
    // previous warn-only check was conditional on `edge.mode === 'direct'`,
    // which let undefined/empty/'cms' values bypass it. The condition below
    // fires whenever the secret would actually reach Voucherify from the
    // browser — i.e. when there is no cache proxy AND the edge worker is
    // not the consumer.
    const willExposeSecretInBrowser =
      !CONFIG.cache.enabled && CONFIG.edge.mode !== 'edge' && !!CONFIG.api.clientSecretKey;
    if (willExposeSecretInBrowser) {
      ppLib.log(
        'error',
        '[ppVoucherify] BLOCKED init: clientSecretKey is set in browser-direct mode and would leak Voucherify credentials. Set cache.enabled=true with a server proxy, or edge.mode="edge". To use the direct API in the browser, remove clientSecretKey and configure clientPublicKey only.'
      );
      return;
    }

    /*! v8 ignore start — jsdom readyState is always 'complete' */
    if (CONFIG.pricing.autoFetch) {
      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', function() {
          fetchPricing();
        });
      } else {
      /*! v8 ignore stop */
        fetchPricing();
      }
    }

    if (CONFIG.offers.autoFetch) {
      fetchOffers();
    }

    initialized = true;
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.voucherify = {
    configure: function(options?: DeepPartial<VoucherifyConfig>) {
      if (options) {
        ppLib.extend(CONFIG, options);
        // Rebuild formatter on locale/currency change so subsequent
        // formatPrice() calls reflect the new config.
        formatter = createPriceFormatter(CONFIG.pricing);
      }
      return CONFIG;
    },

    init: init,

    fetchPricing: function(productIds?: string[]): Promise<PricingResult[]> {
      return fetchPricing(productIds);
    },

    fetchOffers: function(options?: FetchOffersOptions): Promise<OffersResult> {
      return fetchOffers(options);
    },

    validateVoucher: function(code: string, context?: DeepPartial<ValidationContext>): Promise<ValidationResult> {
      try {
        const sanitizedCode = ppLib.Security.sanitize(code);
        if (!sanitizedCode) {
          return Promise.resolve({ valid: false, code: code, reason: 'Empty voucher code' });
        }

        const body: Record<string, unknown> = {
          redeemables: [{ object: 'voucher', id: sanitizedCode }]
        };

        if (context && context.customer) {
          body.customer = context.customer;
        }
        if (context && context.order) {
          body.order = context.order;
        }

        let validateFn: (b: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
        if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
          validateFn = function(b: Record<string, unknown>) {
            return edgeValidateVoucher(sanitizedCode, b).catch(function() {
              ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
              return apiValidations(b);
            });
          };
        } else {
          validateFn = apiValidations;
        }

        return validateFn(body).then(function(response: VoucherifyApiResponse) {
          const redeemables = extractRedeemables(response);
          const redeemable = redeemables[0];
          const result = redeemable && redeemable.result;

          return {
            valid: !!(redeemable && redeemable.status === 'APPLICABLE'),
            code: sanitizedCode,
            discount: result && result.discount,
            reason: redeemable && redeemable.status !== 'APPLICABLE' ? (redeemable.status || 'Unknown') : undefined,
            order: result && result.order ? {
              amount: result.order.amount || 0,
              discount_amount: result.order.discount_amount || 0,
              total_amount: result.order.total_amount || 0
            } : undefined
          } as ValidationResult;
        }).catch(function(err: unknown) {
          // Catch async errors from validateFn (network, edge fallback, typed
          // errors from apiRequest). Without this .catch the rejection
          // propagated as an unhandled promise rejection — the previous
          // surrounding try/catch only caught synchronous failures.
          ppLib.log('error', '[ppVoucherify] validateVoucher failed', ppLib.safeLogError(err));
          return { valid: false, code: sanitizedCode, reason: 'Validation error' } as ValidationResult;
        });
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] validateVoucher error', ppLib.safeLogError(e));
        return Promise.resolve({ valid: false, code: code, reason: 'Validation error' });
      }
    },

    checkQualifications: function(context?: QualificationContext): Promise<QualificationResult> {
      const body = context || { scenario: 'ALL' };

      let qualifyFn: (b: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
      if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
        qualifyFn = function(b: Record<string, unknown>) {
          return edgeCheckQualifications(b).catch(function() {
            ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
            return apiQualifications(b);
          });
        };
      } else {
        qualifyFn = apiQualifications;
      }

      return qualifyFn(body as Record<string, unknown>).then(function(response: VoucherifyApiResponse) {
        return {
          redeemables: response.redeemables || [],
          total: response.total || 0,
          hasMore: response.has_more || false
        } as QualificationResult;
      }).catch(function(err: unknown) {
        // Defensive: callers expect a fulfilled Promise<QualificationResult>;
        // emit an empty-but-shaped result rather than an unhandled rejection.
        ppLib.log('error', '[ppVoucherify] checkQualifications failed', ppLib.safeLogError(err));
        return { redeemables: [], total: 0, hasMore: false } as QualificationResult;
      });
    },

    clearCache: function() {
      clearCache();
    },

    isReady: function() {
      return initialized;
    },

    getConfig: function() {
      return JSON.parse(JSON.stringify(CONFIG));
    },

    getSegment: function() {
      return determineSegment();
    }
  };

  ppLib.log('info', '[ppVoucherify] Module loaded');

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
