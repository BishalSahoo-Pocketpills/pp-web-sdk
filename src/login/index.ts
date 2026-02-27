/**
 * pp-analytics-lib: Login Detection Module v1.0.0
 * Cookie-based auth state detection, body class management, and identity DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.login, window.logoutUser
 */
import type { PPLib } from '../types/common.types';
import type { LoginConfig } from '../types/login.types';
import { createLoginConfig } from './config';
import { createLogoutUser } from './logout';
import { createInitAuthState } from './auth-state';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION (overridable via ppLib.login.configure)
  // =====================================================

  const CONFIG: LoginConfig = createLoginConfig();

  // =====================================================
  // LOGOUT FUNCTION
  // =====================================================

  const logoutUser = createLogoutUser(win, doc, ppLib, CONFIG);

  // =====================================================
  // AUTH STATE DETECTION
  // =====================================================

  const initAuthState = createInitAuthState(doc, ppLib, CONFIG);

  // =====================================================
  // EVENT BINDING
  // =====================================================

  function bindActions(): void {
    try {
      // Bind Regular Logout Buttons
      const logoutButtons = doc.querySelectorAll('[' + CONFIG.actionAttribute + '="logout"]');
      logoutButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          logoutUser(false);
        });
      });

      // Bind "Forget Me" Buttons
      const forgetButtons = doc.querySelectorAll('[' + CONFIG.actionAttribute + '="forget-me"]');
      forgetButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          logoutUser(true);
        });
      });
    } catch (e) {
      ppLib.log('error', '[ppLogin] bindActions error', e);
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    initAuthState();
    bindActions();
  }

  // Auto-initialize on DOM ready
  /*! v8 ignore start */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /*! v8 ignore stop */

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.login = {
    configure: function(options?: Partial<LoginConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    isLoggedIn: function(): boolean {
      const userId = ppLib.getCookie(CONFIG.cookieNames.userId);
      const authToken = ppLib.getCookie(CONFIG.cookieNames.auth);
      return !!(userId && userId !== '-1' && authToken && authToken !== '');
    },

    logout: function(hard?: boolean): void {
      logoutUser(hard);
    },

    getConfig: function(): LoginConfig {
      return CONFIG;
    }
  };

  // Expose global logout function
  win.logoutUser = logoutUser;

  ppLib.log('info', '[ppLogin] Module loaded');

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
