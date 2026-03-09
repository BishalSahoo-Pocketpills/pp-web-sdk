/**
 * pp-analytics-lib: Braze Module v1.0.0
 * Data-attribute-driven Braze integration — forms, events, purchases.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.braze
 */
import type { PPLib } from '../types/common.types';
import type { BrazeConfig } from '../types/braze.types';
import { createBrazeConfig } from './config';
import { createSdkLoader } from './sdk-loader';
import { createUserManager } from './user';
import { createFormHandler } from './forms';
import { createEventHandler } from './events';
import { createPurchaseHandler } from './purchases';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: BrazeConfig = createBrazeConfig();

  // =====================================================
  // SUB-MODULES
  // =====================================================

  const sdkLoader = createSdkLoader(win, doc, ppLib, CONFIG);
  const userManager = createUserManager(win, ppLib, CONFIG);
  const formHandler = createFormHandler(win, doc, ppLib, CONFIG, userManager);
  const eventHandler = createEventHandler(win, doc, ppLib, CONFIG);
  const purchaseHandler = createPurchaseHandler(win, doc, ppLib, CONFIG);

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
        ppLib.log('error', '[ppBraze] consent check error', e);
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
    if (!CONFIG.sdk.apiKey) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppBraze] No apiKey configured. Call ppLib.braze.configure({ sdk: { apiKey: "..." } }) before init.');
      return;
    }

    /*! v8 ignore start */
    if (!CONFIG.sdk.baseUrl) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppBraze] No baseUrl configured. Call ppLib.braze.configure({ sdk: { baseUrl: "..." } }) before init.');
      return;
    }

    // Consent gate
    /*! v8 ignore start */
    if (!hasConsent()) {
    /*! v8 ignore stop */
      ppLib.log('info', '[ppBraze] Consent not granted — SDK not loaded');
      return;
    }

    sdkLoader.loadSDK(function() {
      // Auto-identify from cookies
      userManager.autoIdentify();

      // Bind DOM handlers
      formHandler.bind();
      eventHandler.bind();
      purchaseHandler.bind();
    });
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.braze = {
    configure: function(options?: Partial<BrazeConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    identify: function(userId: string) {
      userManager.identify(userId);
    },

    /*! v8 ignore start */
    setUserAttributes: function(attrs: Record<string, any>) {
      userManager.setUserAttributes(attrs);
    },
    /*! v8 ignore stop */

    /*! v8 ignore start */
    setEmail: function(email: string) {
      userManager.setEmail(email);
    },
    /*! v8 ignore stop */

    trackEvent: function(eventName: string, properties?: Record<string, any>) {
      try {
        var sanitized = ppLib.Security.sanitize(eventName);
        /*! v8 ignore start */
        if (!sanitized) return;
        /*! v8 ignore stop */

        var sanitizedProps: Record<string, any> | undefined;
        /*! v8 ignore start */
        if (properties && typeof properties === 'object') {
          sanitizedProps = {};
          var keys = Object.keys(properties);
          for (var i = 0; i < keys.length; i++) {
            var val = properties[keys[i]];
            if (typeof val === 'string') {
              sanitizedProps[keys[i]] = ppLib.Security.sanitize(val);
            } else {
              sanitizedProps[keys[i]] = val;
            }
          }
        }

        if (sanitizedProps) {
          win.braze.logCustomEvent(sanitized, sanitizedProps);
        } else {
          win.braze.logCustomEvent(sanitized);
        }

        ppLib.log('info', '[ppBraze] trackEvent → ' + sanitized, sanitizedProps);
        /*! v8 ignore stop */
      } catch (e) {
        ppLib.log('error', '[ppBraze] trackEvent error', e);
      }
    },

    trackPurchase: function(productId: string, price: number, currency?: string, quantity?: number, properties?: Record<string, any>) {
      purchaseHandler.trackPurchase(productId, price, currency, quantity, properties);
    },

    /*! v8 ignore start */
    flush: function() {
      try {
        win.braze.requestImmediateDataFlush();
      } catch (e) {
        ppLib.log('error', '[ppBraze] flush error', e);
      }
    },
    /*! v8 ignore stop */

    isReady: function() {
      return sdkLoader.isReady();
    },

    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppBraze] Module loaded');

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
