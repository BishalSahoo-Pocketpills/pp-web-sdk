/**
 * pp-analytics-lib: Login Detection Module
 * Cookie-based auth state detection, body class management, and identity DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.login, window.logoutUser
 */
import type { PPLib } from '@src/types/common.types';
import type { LoginConfig } from '@src/types/login.types';
import { createLoginConfig } from '@src/login/config';
import { createLogoutUser } from '@src/login/logout';
import { createInitAuthState } from '@src/login/auth-state';

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
  // EVENT BINDING (delegation)
  // =====================================================

  var bound = false;

  function handleLoginAction(e: Event): void {
    try {
      var target = e.target as Element;
      /*! v8 ignore start */
      if (!target || !target.closest) return;
      /*! v8 ignore stop */

      var el = target.closest('[' + CONFIG.actionAttribute + ']');
      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      var action = el.getAttribute(CONFIG.actionAttribute);
      if (action === 'logout') {
        e.preventDefault();
        logoutUser(false);
      /*! v8 ignore start */
      } else if (action === 'forget-me') {
      /*! v8 ignore stop */
        e.preventDefault();
        logoutUser(true);
      }
    } catch (err) {
      ppLib.log('error', '[ppLogin] handleLoginAction error', err);
    }
  }

  function bindActions(): void {
    try {
      /*! v8 ignore start */
      if (bound) return;
      /*! v8 ignore stop */
      bound = true;
      doc.addEventListener('click', handleLoginAction, { capture: false, passive: false } as EventListenerOptions);
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
      return JSON.parse(JSON.stringify(CONFIG));
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
