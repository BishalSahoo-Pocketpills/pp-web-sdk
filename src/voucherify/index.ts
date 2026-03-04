/**
 * pp-analytics-lib: Voucherify Module v1.0.0
 * Readonly pricing integration — qualifications, validation, DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.voucherify
 */
import type { PPLib } from '../types/common.types';
import type { VoucherifyConfig, ValidationContext, QualificationContext, PricingResult, ValidationResult, QualificationResult } from '../types/voucherify.types';
import { createVoucherifyConfig } from './config';
import { createApiClient } from './api-client';
import { createContextBuilder } from './context';
import { createPricingEngine } from './pricing';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VoucherifyConfig = createVoucherifyConfig();

  // =====================================================
  // SUB-MODULES
  // =====================================================

  const apiClient = createApiClient(win, ppLib, CONFIG);
  const contextBuilder = createContextBuilder(win, doc, ppLib, CONFIG);
  const pricingEngine = createPricingEngine(win, doc, ppLib, CONFIG, apiClient, contextBuilder);

  // =====================================================
  // CONSENT CHECK
  // =====================================================

  function hasConsent(): boolean {
    /*! v8 ignore start */
    if (!CONFIG.consent.required) return true;
    /*! v8 ignore stop */

    /*! v8 ignore start */
    if (CONFIG.consent.mode === 'analytics') {
    /*! v8 ignore stop */
      try {
        /*! v8 ignore start */
        if (win.ppAnalytics && typeof win.ppAnalytics.consent === 'object' &&
            typeof win.ppAnalytics.consent.status === 'function') {
        /*! v8 ignore stop */
          return win.ppAnalytics.consent.status();
        }
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] consent check error', e);
      }
      return false;
    }

    // custom mode
    return CONFIG.consent.checkFunction();
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    /*! v8 ignore start */
    if (!CONFIG.api.applicationId && !CONFIG.cache.enabled) {
      ppLib.log('warn', '[ppVoucherify] No applicationId configured and cache not enabled. Call ppLib.voucherify.configure() before init.');
      return;
    }
    /*! v8 ignore stop */

    // Consent gate
    /*! v8 ignore start */
    if (!hasConsent()) {
      ppLib.log('info', '[ppVoucherify] Consent not granted — module not initialized');
      return;
    }
    /*! v8 ignore stop */

    /*! v8 ignore start */
    if (CONFIG.pricing.autoFetch) {
      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', function() {
          pricingEngine.fetchPricing();
        });
      } else {
      /*! v8 ignore stop */
        pricingEngine.fetchPricing();
      }
    }
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.voucherify = {
    configure: function(options?: Partial<VoucherifyConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    fetchPricing: function(productIds?: string[]): Promise<PricingResult[]> {
      return pricingEngine.fetchPricing(productIds);
    },

    validateVoucher: function(code: string, context?: Partial<ValidationContext>): Promise<ValidationResult> {
      try {
        var sanitizedCode = ppLib.Security.sanitize(code);
        /*! v8 ignore start */
        if (!sanitizedCode) {
        /*! v8 ignore stop */
          return Promise.resolve({ valid: false, code: code, reason: 'Empty voucher code' });
        }

        var body: any = {
          redeemables: [{ object: 'voucher', id: sanitizedCode }]
        };

        /*! v8 ignore start */
        if (context && context.customer) {
        /*! v8 ignore stop */
          body.customer = context.customer;
        }
        /*! v8 ignore start */
        if (context && context.order) {
        /*! v8 ignore stop */
          body.order = context.order;
        }

        return apiClient.validations(body).then(function(response: any) {
          var redeemable = response.redeemables && response.redeemables[0];
          var result = redeemable && redeemable.result;

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
        });
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] validateVoucher error', e);
        return Promise.resolve({ valid: false, code: code, reason: 'Validation error' });
      }
    },

    checkQualifications: function(context?: QualificationContext): Promise<QualificationResult> {
      var body = context || { scenario: 'ALL' };
      return apiClient.qualifications(body).then(function(response: any) {
        /*! v8 ignore start */
        return {
          redeemables: response.redeemables || [],
          total: response.total || 0,
          hasMore: response.has_more || false
        } as QualificationResult;
        /*! v8 ignore stop */
      });
    },

    clearCache: function() {
      apiClient.clearCache();
    },

    isReady: function() {
      return true;
    },

    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppVoucherify] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available
  /*! v8 ignore start */
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }
  /*! v8 ignore stop */

})(window, document);
