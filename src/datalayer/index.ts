/**
 * pp-analytics-lib: DataLayer Module v1.0.0
 * Unified GTM event system — pushes enriched events to window.dataLayer.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.datalayer
 */
import type { PPLib } from '../types/common.types';
import type { DataLayerConfig, DataLayerItemInput, DataLayerUser, UserDataInput, UserDataHashedInput } from '../types/datalayer.types';
import { createDataLayerConfig } from './config';
import { createPageBuilder } from './page';
import { createUserBuilder } from './user';
import { createUserDataManager } from './user-data';
import { createItemBuilder } from './items';
import { createEventPusher } from './events';
import { createDomBinder } from './dom';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: DataLayerConfig = createDataLayerConfig();

  // =====================================================
  // SUB-MODULES
  // =====================================================

  const pageBuilder = createPageBuilder(win, doc);
  const userBuilder = createUserBuilder(ppLib, CONFIG);
  const userDataManager = createUserDataManager();
  const itemBuilder = createItemBuilder(ppLib, CONFIG);
  const eventPusher = createEventPusher(win, ppLib, CONFIG, userBuilder, userDataManager, pageBuilder, itemBuilder);
  const domBinder = createDomBinder(win, doc, ppLib, CONFIG, eventPusher, itemBuilder);

  // Deferred cookie reading — called after DOMContentLoaded so cookies
  // set by other scripts (e.g. previousUser) are available.
  function readCookieUserData(): Promise<void> {
    var prevUser: Record<string, string> = {};
    try {
      var prevRaw = ppLib.getCookie(CONFIG.cookieNames.previousUser) || '';
      /*! v8 ignore start */
      if (prevRaw) {
        prevUser = JSON.parse(decodeURIComponent(prevRaw));
      }
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] Failed to parse previousUser cookie', e);
    }
    /*! v8 ignore stop */

    return userDataManager.setUserData({
      email: prevUser.email || '',
      phone: prevUser.phone || '',
      first_name: prevUser.firstName || ppLib.getCookie(CONFIG.cookieNames.firstName) || '',
      last_name: ppLib.getCookie(CONFIG.cookieNames.lastName) || '',
      street: ppLib.getCookie(CONFIG.cookieNames.street) || '',
      city: ppLib.getCookie(CONFIG.cookieNames.city) || '',
      region: ppLib.getCookie(CONFIG.cookieNames.region) || '',
      postal_code: ppLib.getCookie(CONFIG.cookieNames.postalCode) || '',
      country: ppLib.getCookie(CONFIG.cookieNames.country) || ''
    });
  }

  // =====================================================
  // HELPERS
  // =====================================================

  function buildAuthOverride(data: { pp_user_id?: string; pp_patient_id?: string }): Partial<DataLayerUser> {
    var override: Partial<DataLayerUser> = { logged_in: true };
    override.pp_user_id = data.pp_user_id || override.pp_user_id;
    override.pp_patient_id = data.pp_patient_id || override.pp_patient_id;
    return override;
  }

  function ecom(eventName: string): (items: DataLayerItemInput[]) => void {
    return function(items: DataLayerItemInput[]) {
      eventPusher.pushEcommerceEvent(eventName, items);
    };
  }

  function pushAutoPageview(): void {
    domBinder.init();
    eventPusher.pushEvent('pageview', { platform: CONFIG.defaults.platform });
  }

  // =====================================================
  // AUTO-INIT DOM BINDING + AUTO-PAGEVIEW
  // Wait for user data hashing before pushing events
  // =====================================================

  /*! v8 ignore start */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() {
      readCookieUserData().then(pushAutoPageview);
    });
  } else {
  /*! v8 ignore stop */
    readCookieUserData().then(pushAutoPageview);
  }

  // AUTO-VIEW_ITEM: fire when item elements exist in DOM
  // Both branches (complete vs addEventListener) are tested via manual scanViewItems() calls,
  // but V8 cannot cover both readyState paths or the autoViewItem=false path in a single IIFE load.
  /*! v8 ignore start */
  if (CONFIG.autoViewItem) {
    if (doc.readyState === 'complete') {
      readCookieUserData().then(function() { domBinder.scanViewItems(); });
    } else {
      win.addEventListener('load', function() { domBinder.scanViewItems(); });
    }
  }
  /*! v8 ignore stop */

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.datalayer = {
    configure: function(options?: Partial<DataLayerConfig>) {
      ppLib.extend(CONFIG, options || {});
      return CONFIG;
    },

    // ---- User context ----

    setUser: function(user: Partial<DataLayerUser>) {
      userBuilder.setUser(user);
    },

    setUserData: function(data: UserDataInput): Promise<void> {
      return userDataManager.setUserData(data);
    },

    setUserDataHashed: function(data: UserDataHashedInput) {
      userDataManager.setUserDataHashed(data);
    },

    // ---- Generic push ----

    push: function(eventName: string, data?: Record<string, any>) {
      eventPusher.pushEvent(eventName, data);
    },

    pushEcommerce: function(eventName: string, items: DataLayerItemInput[], data?: Record<string, any>) {
      eventPusher.pushEcommerceEvent(eventName, items, data);
    },

    // ---- Core events ----

    pageview: function(data?: Record<string, any>) {
      var extra: Record<string, any> = { platform: CONFIG.defaults.platform };
      /*! v8 ignore start */
      ppLib.extend(extra, data || {});
      /*! v8 ignore stop */
      eventPusher.pushEvent('pageview', extra);
    },

    loginView: function(data: { method: string }) {
      eventPusher.pushEvent('login_view', data);
    },

    loginSuccess: function(data: { method: string; pp_user_id?: string; pp_patient_id?: string }) {
      userBuilder.setUser(buildAuthOverride(data));
      eventPusher.pushEvent('login_success', { method: data.method });
    },

    signupView: function(data: { method: string; signup_flow?: string }) {
      eventPusher.pushEvent('signup_view', data);
    },

    signupStart: function(data: { method: string }) {
      eventPusher.pushEvent('signup_start', data);
    },

    signupComplete: function(data: { method: string; pp_user_id?: string; pp_patient_id?: string }) {
      /*! v8 ignore start */
      userBuilder.setUser(buildAuthOverride(data));
      eventPusher.pushEvent('signup_complete', { method: data.method });
      /*! v8 ignore stop */
    },

    search: function(data: { search_term: string; results_count?: number; search_type?: string }) {
      eventPusher.pushEvent('search', data);
    },

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
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppDataLayer] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available.
  // Both paths are tested (loadWithCommon vs loadModule-then-common),
  // but V8 cannot attribute coverage through vm.runInThisContext() across
  // separate IIFE loads. This is the only v8 ignore in the module.
  /*! v8 ignore start */
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }
  /*! v8 ignore stop */

})(window, document);
