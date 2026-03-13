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

  // Deferred cookie reading — called after window.load so cookies
  // set by other scripts (e.g. previousUser) are available.
  function readCookieUserData(): Promise<void> {
    var prevUser: Record<string, string> = {};
    try {
      var prevRaw = ppLib.getCookie(CONFIG.cookieNames.previousUser) || '';
      console.log('[ppDataLayer DEBUG] getCookie("previousUser") raw:', prevRaw);
      prevUser = prevRaw ? JSON.parse(prevRaw) : {};
      console.log('[ppDataLayer DEBUG] parsed previousUser:', prevUser);
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] Failed to parse previousUser cookie', e);
      console.log('[ppDataLayer DEBUG] parse error:', e);
    }

    var userData = {
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
    console.log('[ppDataLayer DEBUG] calling setUserData with:', userData);

    return userDataManager.setUserData(userData);
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

  function coreEvent(eventName: string): (data: Record<string, any>) => void {
    return function(data: Record<string, any>) {
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
    console.log('[ppDataLayer DEBUG] onReady fired, doc.readyState:', doc.readyState);
    readCookieUserData().then(function() {
      var ud = userDataManager.getUserData();
      console.log('[ppDataLayer DEBUG] after setUserData, user_data:', JSON.stringify(ud));
      eventPusher.pushEvent('pageview', { platform: CONFIG.defaults.platform });
      CONFIG.autoViewItem && domBinder.scanViewItems();

      // If previousUser cookie wasn't available yet, poll for it
      console.log('[ppDataLayer DEBUG] sha256_email:', ud.sha256_email_address, 'sha256_phone:', ud.sha256_phone_number);
      !ud.sha256_email_address && !ud.sha256_phone_number && (console.log('[ppDataLayer DEBUG] starting polling'), pollPreviousUser(20));
    });
  }

  // Poll for previousUser cookie (set by late-loading scripts)
  function pollPreviousUser(remaining: number): void {
    remaining > 0 && win.setTimeout(function() {
      var raw = ppLib.getCookie(CONFIG.cookieNames.previousUser) || '';
      console.log('[ppDataLayer DEBUG] poll attempt', 21 - remaining, '- cookie:', raw ? 'FOUND' : 'empty');
      raw
        ? (readCookieUserData(), ppLib.log('info', '[ppDataLayer] previousUser cookie found after polling'))
        : pollPreviousUser(remaining - 1);
    }, 500);
  }

  console.log('[ppDataLayer DEBUG] doc.readyState at init:', doc.readyState);
  if (doc.readyState === 'complete') {
    win.setTimeout(onReady, 0);
  } else {
    win.addEventListener('load', function() { win.setTimeout(onReady, 0); });
  }

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
      ppLib.extend(extra, data || {});
      eventPusher.pushEvent('pageview', extra);
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
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppDataLayer] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available.
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }

})(window, document);
