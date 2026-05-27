/**
 * pp-analytics-lib: Braze Module
 * Data-attribute-driven Braze integration — forms, events, purchases.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.braze
 */
import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';
import type { DeepPartial } from '@src/types/utility.types';
import { createBrazeConfig } from '@src/braze/config';
import { createSdkLoader } from '@src/braze/sdk-loader';
import { createUserManager } from '@src/braze/user';
import { createFormHandler } from '@src/braze/forms';
import { createEventHandler } from '@src/braze/events';
import { createPurchaseHandler } from '@src/braze/purchases';
import { bootstrapModule } from '@src/common/bootstrap';
import { checkModuleConsent } from '@src/common/consent-gate';
import { cloneConfig } from '@src/common/clone-config';
import { isConsentGranted } from '@src/common/consent-check';

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
    return checkModuleConsent(CONFIG.consent, { win, ppLib, logPrefix: '[ppBraze]' });
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

  function checkReady(): boolean {
    return sdkLoader.isReady();
  }

  function getConfig(): BrazeConfig {
    return cloneConfig(CONFIG);
  }

  function trackEvent(eventName: string, properties?: Record<string, unknown>): void {
    try {
      if (!isConsentGranted(ppLib)) return;
      const sanitized = ppLib.Security.sanitize(eventName);
      /*! v8 ignore start */
      if (!sanitized) return;
      /*! v8 ignore stop */

      let sanitizedProps: Record<string, unknown> | undefined;
      /*! v8 ignore start */
      if (properties && typeof properties === 'object') {
        sanitizedProps = {};
        const keys = Object.keys(properties);
        for (let i = 0; i < keys.length; i++) {
          const val = properties[keys[i]];
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

      const safeProps = sanitizedProps ? ppLib.safeLogPayload(sanitizedProps) : undefined;
      ppLib.log('info', '[ppBraze] trackEvent → ' + sanitized, safeProps);
      /*! v8 ignore stop */
    } catch (e) {
      ppLib.log('error', '[ppBraze] trackEvent error', ppLib.safeLogError(e));
    }
  }

  ppLib.braze = {
    configure: function(options?: DeepPartial<BrazeConfig>) {
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
    setUserAttributes: function(attrs: Record<string, unknown>) {
      userManager.setUserAttributes(attrs);
    },
    /*! v8 ignore stop */

    /*! v8 ignore start */
    setEmail: function(email: string) {
      userManager.setEmail(email);
    },
    /*! v8 ignore stop */

    trackEvent: trackEvent,

    trackPurchase: function(productId: string, price: number, currency?: string, quantity?: number, properties?: Record<string, unknown>) {
      purchaseHandler.trackPurchase(productId, price, currency, quantity, properties);
    },

    /*! v8 ignore start */
    flush: function() {
      try {
        win.braze.requestImmediateDataFlush();
      } catch (e) {
        ppLib.log('error', '[ppBraze] flush error', ppLib.safeLogError(e));
      }
    },
    /*! v8 ignore stop */

    isReady: checkReady,

    getConfig: getConfig
  };

  ppLib.log('info', '[ppBraze] Module loaded');

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
