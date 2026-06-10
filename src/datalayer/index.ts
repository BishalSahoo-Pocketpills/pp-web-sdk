/**
 * pp-analytics-lib: DataLayer Module
 * Unified GTM event system — pushes enriched events to window.dataLayer.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.datalayer
 */
import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItemInput, DataLayerUser, UserDataInput, UserDataHashedInput } from '@src/types/datalayer.types';
import type { DeepPartial } from '@src/types/utility.types';
import { createDataLayerConfig } from '@src/datalayer/config';
import { createPageBuilder } from '@src/datalayer/page';
import { createUserBuilder } from '@src/datalayer/user';
import { createUserDataManager } from '@src/datalayer/user-data';
import { createItemBuilder } from '@src/datalayer/items';
import { createEventPusher } from '@src/datalayer/events';
import { createDomBinder } from '@src/datalayer/dom';
import { createEventPropertiesEnricher } from '@src/datalayer/enrichers/event-properties';
import { bootstrapModule } from '@src/common/bootstrap';
import { cloneConfig } from '@src/common/clone-config';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: DataLayerConfig = createDataLayerConfig();

  // Register event-properties enricher with the global coordinator
  if (ppLib.registerEnricher) {
    ppLib.registerEnricher(createEventPropertiesEnricher(win, ppLib, CONFIG));
  }

  // =====================================================
  // SUB-MODULES
  // =====================================================

  const pageBuilder = createPageBuilder(win, doc);
  const userBuilder = createUserBuilder(ppLib, CONFIG);
  const userDataManager = createUserDataManager(ppLib);
  const itemBuilder = createItemBuilder(ppLib, CONFIG);
  const eventPusher = createEventPusher(win, ppLib, CONFIG, userBuilder, userDataManager, pageBuilder, itemBuilder);
  const domBinder = createDomBinder(win, doc, ppLib, CONFIG, eventPusher, itemBuilder);

  // Deferred cookie reading — called after window.load so cookies
  // set by other scripts (e.g. previousUser) are available.
  function readCookieUserData(): Promise<void> {
    let prevUser: Record<string, string> = {};
    try {
      const prevRaw = ppLib.getCookie(CONFIG.cookieNames.previousUser) || '';
      prevUser = prevRaw ? JSON.parse(decodeURIComponent(prevRaw)) : {};
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] Failed to parse previousUser cookie', ppLib.safeLogError(e));
    }

    const userData = {
      email: prevUser.email || '',
      phone: prevUser.phone || '',
      first_name: prevUser.firstName || ppLib.getCookie(CONFIG.cookieNames.firstName) || '',
      last_name: ppLib.getCookie(CONFIG.cookieNames.lastName) || '',
      street: ppLib.getCookie(CONFIG.cookieNames.street) || '',
      city: ppLib.getCookie(CONFIG.cookieNames.city) || '',
      region: ppLib.getCookie(CONFIG.cookieNames.region) || '',
      postal_code: ppLib.getCookie(CONFIG.cookieNames.postalCode) || '',
      country: ppLib.getCookie(CONFIG.cookieNames.country) || ''
    };

    return userDataManager.setUserData(userData);
  }

  // =====================================================
  // HELPERS
  // =====================================================

  function buildAuthOverride(data: { pp_user_id?: string; pp_patient_id?: string }): Partial<DataLayerUser> {
    const override: Partial<DataLayerUser> = { logged_in: 'true' };
    override.pp_user_id = data.pp_user_id || override.pp_user_id;
    override.pp_patient_id = data.pp_patient_id || override.pp_patient_id;
    return override;
  }

  function ecom(eventName: string): (items: DataLayerItemInput[]) => void {
    return function(items: DataLayerItemInput[]) {
      eventPusher.pushEcommerceEvent(eventName, items);
    };
  }

  function coreEvent(eventName: string): (data: Record<string, unknown>) => void {
    return function(data: Record<string, unknown>) {
      eventPusher.pushEvent(eventName, data);
    };
  }

  // =====================================================
  // AUTO-INIT: DOM binding early, events after window.load
  // Cookies set by client-side JS (e.g. previousUser) may not
  // be available until all scripts have executed, so we defer
  // cookie reading + event pushing to the load event.
  // =====================================================

  // Bind DOM click/touch listeners early (DOMContentLoaded)
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() { domBinder.init(); });
  } else {
    domBinder.init();
  }

  // Read cookies + push pageview + scanViewItems after window.load
  function onReady(): void {
    readCookieUserData().then(function() {
      const ud = userDataManager.getUserData();
      eventPusher.pushEvent('page_view');
      CONFIG.autoViewItem && domBinder.scanViewItems();

      // If previousUser cookie wasn't available yet, poll for it
      !ud.sha256_email_address && !ud.sha256_phone_number && pollPreviousUser(20);
    }).catch(function(e: unknown) {
      ppLib.log('error', '[ppDataLayer] onReady error', ppLib.safeLogError(e));
    });
  }

  /**
   * Poll for previousUser cookie set by late-loading scripts.
   * Strategy: 20 attempts × 500ms = max 10s wait.
   * Combined with the CONFIG.initDelay (default 1500ms), total max wait
   * is ~11.5s from window.load. Covers scripts loaded via GTM containers.
   */
  let pollTimerId: number | null = null;

  function onPollFound(): void {
    pollTimerId = null;
    readCookieUserData();
    ppLib.log('info', '[ppDataLayer] previousUser cookie found after polling');
  }

  function pollPreviousUser(remaining: number): void {
    if (remaining > 0) {
      pollTimerId = win.setTimeout(function() {
        const raw = ppLib.getCookie(CONFIG.cookieNames.previousUser) || '';
        if (raw) {
          onPollFound();
        } else {
          pollPreviousUser(remaining - 1);
        }
      }, 500);
    } else {
      pollTimerId = null;
    }
  }

  // Defer onReady by 1500ms so late-loading scripts (GTM tags)
  // have time to set cookies before we read them.
  if (doc.readyState === 'complete') {
    win.setTimeout(onReady, CONFIG.initDelay);
  } else {
    win.addEventListener('load', function() { win.setTimeout(onReady, CONFIG.initDelay); });
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.datalayer = {
    configure: function(options?: DeepPartial<DataLayerConfig>) {
      ppLib.extend(CONFIG, options || {});
      return CONFIG;
    },

    // ---- User context ----

    setUser: function(user: DeepPartial<DataLayerUser>) {
      userBuilder.setUser(user);
    },

    setUserData: function(data: UserDataInput): Promise<void> {
      return userDataManager.setUserData(data);
    },

    setUserDataHashed: function(data: UserDataHashedInput) {
      userDataManager.setUserDataHashed(data);
    },

    // ---- Generic push ----

    push: function(eventName: string, data?: Record<string, unknown>) {
      eventPusher.pushEvent(eventName, data);
    },

    pushEcommerce: function(eventName: string, items: DataLayerItemInput[], data?: Record<string, unknown>) {
      eventPusher.pushEcommerceEvent(eventName, items, data);
    },

    // ---- Core events ----

    pageview: function(data?: Record<string, unknown>) {
      const extra: Record<string, unknown> = { platform: CONFIG.defaults.platform };
      ppLib.extend(extra, data || {});
      eventPusher.pushEvent('page_view', extra);
    },

    loginView: coreEvent('login_view'),

    loginSuccess: function(data: { method: string; pp_user_id?: string; pp_patient_id?: string }) {
      userBuilder.setUser(buildAuthOverride(data));
      eventPusher.pushEvent('login_success', { method: data.method });
    },

    signupView: coreEvent('signup_view'),
    signupStart: coreEvent('signup_start'),

    signupComplete: function(data: { method: string; pp_user_id?: string; pp_patient_id?: string }) {
      userBuilder.setUser(buildAuthOverride(data));
      eventPusher.pushEvent('signup_complete', { method: data.method });
    },

    search: coreEvent('search'),

    // ---- Ecommerce events ----

    viewItem: ecom('view_item'),
    addToCart: ecom('add_to_cart'),
    beginCheckout: ecom('begin_checkout'),
    addPaymentInfo: ecom('add_payment_info'),

    purchase: function(transactionId: string, items: DataLayerItemInput[]) {
      eventPusher.pushEcommerceEvent('purchase', items, { transaction_id: transactionId });
    },

    // ---- DOM binding ----

    init: domBinder.init,
    bindDOM: domBinder.init,
    scanViewItems: domBinder.scanViewItems,

    getConfig: function(): DataLayerConfig {
      return cloneConfig(CONFIG);
    }
  };

  ppLib.log('info', '[ppDataLayer] Module loaded');

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
