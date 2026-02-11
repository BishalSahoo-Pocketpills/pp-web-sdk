/**
 * pp-analytics-lib: Login Detection Module v1.0.0
 * Cookie-based auth state detection, body class management, and identity DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.login, window.logoutUser
 *
 * Migration: Uses [data-login-identifier-key] instead of element IDs
 *   e.g. <span data-login-identifier-key="user-first-name"></span>
 *
 * Body classes applied:
 *   - is-logged-in / is-logged-out
 *   - signup-completed
 *   - has-previous-user
 *   - dom-ready
 *
 * Data attributes used:
 *   - data-action="logout"       → soft logout (session cookies only)
 *   - data-action="forget-me"    → hard logout (all cookies including previous user)
 *   - data-login-identifier-key  → DOM elements to inject identity data into
 */
(function(window, document, undefined) {
  'use strict';

  var ppLib = window.ppLib;
  if (!ppLib) {
    console.error('[ppLogin] common.js must be loaded first');
    return;
  }

  // =====================================================
  // CONFIGURATION (overridable via ppLib.login.configure)
  // =====================================================

  var CONFIG = {
    cookieNames: {
      userId: 'userId',
      patientId: 'patientId',
      auth: 'Authorization',
      appAuth: 'app_is_authenticated',
      prevUser: 'previousUser',
      firstName: 'firstName'
    },
    bodyClasses: {
      loggedIn: 'is-logged-in',
      loggedOut: 'is-logged-out',
      signupCompleted: 'signup-completed',
      hasPreviousUser: 'has-previous-user',
      domReady: 'dom-ready'
    },
    identifierAttribute: 'data-login-identifier-key',
    actionAttribute: 'data-action',
    reloadOnLogout: true
  };

  // =====================================================
  // LOGOUT FUNCTION
  // =====================================================

  function logoutUser(hardLogout) {
    try {
      hardLogout = hardLogout === true;

      // Remove session cookies
      ppLib.deleteCookie(CONFIG.cookieNames.userId);
      ppLib.deleteCookie(CONFIG.cookieNames.patientId);
      ppLib.deleteCookie(CONFIG.cookieNames.auth);
      ppLib.deleteCookie(CONFIG.cookieNames.appAuth);

      // Hard logout: also remove previous user data
      if (hardLogout) {
        ppLib.deleteCookie(CONFIG.cookieNames.prevUser);
        ppLib.deleteCookie(CONFIG.cookieNames.firstName);
      }

      // Update UI state immediately
      document.body.classList.remove(CONFIG.bodyClasses.loggedIn, CONFIG.bodyClasses.signupCompleted);
      document.body.classList.add(CONFIG.bodyClasses.loggedOut);

      // Reload page to reset state cleanly
      if (CONFIG.reloadOnLogout) {
        window.location.reload();
      }
    } catch (e) {
      ppLib.log('error', '[ppLogin] Logout error', e);
    }
  }

  // =====================================================
  // AUTH STATE DETECTION
  // =====================================================

  function initAuthState() {
    try {
      var userId = ppLib.getCookie(CONFIG.cookieNames.userId);
      var authToken = ppLib.getCookie(CONFIG.cookieNames.auth);
      var appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth);
      var prevUserCookie = ppLib.getCookie(CONFIG.cookieNames.prevUser);
      var firstNameCookie = ppLib.getCookie(CONFIG.cookieNames.firstName);

      // A. Check Logged In Status
      var isUserIdValid = userId && userId !== '-1';
      var isAuthTokenValid = authToken && authToken !== '';

      if (isUserIdValid && isAuthTokenValid) {
        document.body.classList.add(CONFIG.bodyClasses.loggedIn);
      } else {
        document.body.classList.add(CONFIG.bodyClasses.loggedOut);
      }

      // B. Check Signup Completion
      if (appAuth === 'true') {
        document.body.classList.add(CONFIG.bodyClasses.signupCompleted);
      }

      // C. Check Previous User (Welcome Back)
      var hasPreviousUser = false;
      var previousUserName = '';

      // Try parsing JSON cookie
      if (prevUserCookie) {
        try {
          var userData = JSON.parse(prevUserCookie);
          if (userData && (userData.firstName || userData.phone)) {
            hasPreviousUser = true;
            if (userData.firstName) previousUserName = userData.firstName;
          }
        } catch (e) {
          ppLib.log('error', '[ppLogin] Previous user JSON parse error', e);
        }
      }

      // Fallback to simple string cookie
      if (firstNameCookie) {
        hasPreviousUser = true;
        previousUserName = firstNameCookie;
      }

      if (hasPreviousUser) {
        document.body.classList.add(CONFIG.bodyClasses.hasPreviousUser);

        // Inject name into elements with data-login-identifier-key="user-first-name"
        var nameElements = document.querySelectorAll('[' + CONFIG.identifierAttribute + '="user-first-name"]');
        nameElements.forEach(function(el) {
          el.innerText = previousUserName;
        });
      }

      // Mark DOM as ready (for opacity transition if used)
      document.body.classList.add(CONFIG.bodyClasses.domReady);

      ppLib.log('info', '[ppLogin] Auth state initialized', {
        loggedIn: isUserIdValid && isAuthTokenValid,
        signupCompleted: appAuth === 'true',
        hasPreviousUser: hasPreviousUser
      });

    } catch (e) {
      ppLib.log('error', '[ppLogin] initAuthState error', e);
    }
  }

  // =====================================================
  // EVENT BINDING
  // =====================================================

  function bindActions() {
    try {
      // Bind Regular Logout Buttons
      var logoutButtons = document.querySelectorAll('[' + CONFIG.actionAttribute + '="logout"]');
      logoutButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          logoutUser(false);
        });
      });

      // Bind "Forget Me" Buttons
      var forgetButtons = document.querySelectorAll('[' + CONFIG.actionAttribute + '="forget-me"]');
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

  function init() {
    initAuthState();
    bindActions();
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.login = {
    configure: function(options) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    isLoggedIn: function() {
      var userId = ppLib.getCookie(CONFIG.cookieNames.userId);
      var authToken = ppLib.getCookie(CONFIG.cookieNames.auth);
      return !!(userId && userId !== '-1' && authToken && authToken !== '');
    },

    logout: function(hard) {
      logoutUser(hard);
    },

    getConfig: function() {
      return CONFIG;
    }
  };

  // Expose global logout function
  window.logoutUser = logoutUser;

  ppLib.log('info', '[ppLogin] Module loaded');

})(window, document);
