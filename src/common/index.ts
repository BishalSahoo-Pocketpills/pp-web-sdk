/**
 * pp-analytics-lib: Common Module
 * Shared utilities used by all other modules.
 * Load this FIRST via <script> before any other module.
 *
 * Exposes: window.ppLib
 */
import type { PPLib } from '@src/types/common.types';
import { createSafeUtils } from '@src/common/safe-utils';
import { createConfig } from '@src/common/config';
import { createGetCookie, createDeleteCookie } from '@src/common/cookies';
import { createGetQueryParam } from '@src/common/url';
import { createSecurity } from '@src/common/security';
import { createStorage } from '@src/common/storage';
import { createExtend } from '@src/common/utils';
import { createAttributionService } from '@src/common/attribution';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  var ppLib: PPLib = win.ppLib = win.ppLib || {} as PPLib;
  ppLib.version = __PP_SDK_VERSION__;

  // =====================================================
  // CONFIGURATION (BASE)
  // =====================================================

  ppLib.config = createConfig();

  // =====================================================
  // LOGGING
  // =====================================================

  ppLib.log = function(level: string, message: string, data?: any) {
    /*! v8 ignore start */
    if (level !== 'error' && level !== 'warn') {
      if (!ppLib.config.debug) return;
      if (level === 'verbose' && !ppLib.config.verbose) return;
    }
    /*! v8 ignore stop */

    try {
      const prefix = '[ppLib v' + ppLib.version + ']';
      const logFn = (console as any)[level] || console.log;
      logFn.call(console, prefix, message, data || '');
    } catch (e) {
      // Silent fail for logging
    }
  };

  // =====================================================
  // SAFE UTILITIES (NULL-SAFE)
  // =====================================================

  ppLib.SafeUtils = createSafeUtils(ppLib.log);

  // =====================================================
  // COOKIE UTILITIES
  // =====================================================

  ppLib.getCookie = createGetCookie(doc);
  ppLib.deleteCookie = createDeleteCookie(doc, win, ppLib.log);

  // =====================================================
  // URL UTILITIES
  // =====================================================

  ppLib.getQueryParam = createGetQueryParam();

  // =====================================================
  // SECURITY MODULE (NULL-SAFE)
  // =====================================================

  ppLib.Security = createSecurity(ppLib.config, ppLib.SafeUtils, ppLib.log);

  // =====================================================
  // STORAGE MODULE (NULL-SAFE)
  // =====================================================

  ppLib.Storage = createStorage(win, ppLib.config, ppLib.SafeUtils, ppLib.Security, ppLib.log);

  // =====================================================
  // UTILITY HELPERS
  // =====================================================

  ppLib.extend = createExtend(ppLib.log);

  // =====================================================
  // MARKETING ATTRIBUTION SERVICE
  // Shared across all modules — single extraction, unified enrichment
  // =====================================================

  ppLib.attribution = createAttributionService(win, ppLib);

  // =====================================================
  // MODULE READY SYSTEM
  // Ensures modules can safely wait for common.js
  // =====================================================

  ppLib._isReady = true;

  ppLib.ready = function(callback: (ppLib: PPLib) => void) {
    /*! v8 ignore start */
    if (typeof callback !== 'function') return;
    /*! v8 ignore stop */

    callback(ppLib);
  };

  // Process any callbacks registered before common.js loaded
  // (modules that loaded first and queued via window.ppLibReady)
  /*! v8 ignore start */
  if (win.ppLibReady && Array.isArray(win.ppLibReady)) {
    for (let i = 0; i < win.ppLibReady.length; i++) {
      if (typeof win.ppLibReady[i] === 'function') {
        win.ppLibReady[i](ppLib);
      }
    }
    win.ppLibReady = null;
  }
  /*! v8 ignore stop */

  ppLib.log('info', 'Common module loaded');

})(window, document);
