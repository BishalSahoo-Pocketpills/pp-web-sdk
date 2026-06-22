/**
 * pp-analytics-lib: Analytics & Attribution Tracker
 * Based on PocketPills Analytics & Attribution Tracker v3.1
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppAnalytics
 */
import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';
import type { DeepPartial } from '@src/types/utility.types';
import { bootstrapModule } from '@src/common/bootstrap';
import { cloneConfig } from '@src/common/clone-config';
import { createAnalyticsConfig } from '@src/analytics/config';
import { createAnalyticsUtils } from '@src/analytics/utils';
import { createAnalyticsConsent } from '@src/analytics/consent';
import { createUrlParser } from '@src/analytics/url-parser';
import { createSession } from '@src/analytics/session';
import { createPlatforms } from '@src/analytics/platforms';
import { createEventQueue } from '@src/analytics/event-queue';
import { createTracker } from '@src/analytics/tracker';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  const Storage = ppLib.Storage;

  // =====================================================
  // CONFIGURATION + SUB-MODULES
  // =====================================================

  const CONFIG: AnalyticsConfig = createAnalyticsConfig(ppLib);
  const utils = createAnalyticsUtils(CONFIG, ppLib);

  const consent = createAnalyticsConsent(win, ppLib, CONFIG, utils, {
    onGranted: function() {
      tracker.init();
    },
    onRevoked: function() {
      Storage.clear();
    }
  });

  const urlParser = createUrlParser(win, doc, ppLib, utils);
  const session = createSession(ppLib, CONFIG, utils);
  const platforms = createPlatforms(win, ppLib, CONFIG, utils);
  const eventQueue = createEventQueue(win, ppLib, CONFIG, utils, platforms);
  const tracker = createTracker(win, doc, ppLib, CONFIG, utils, {
    consent: consent,
    urlParser: urlParser,
    session: session,
    eventQueue: eventQueue
  });

  // =====================================================
  // PUBLIC API
  // =====================================================

  const API = {
    version: CONFIG.version,

    config: function(options?: DeepPartial<AnalyticsConfig>) {
      try {
        /*! v8 ignore start */
        if (options) {
        /*! v8 ignore stop */
          ppLib.extend(CONFIG, options);
          utils.resetParamCache();
          utils.log('info', 'Configuration updated');
        }
        return cloneConfig(CONFIG);
      } catch (e) {
        utils.log('error', 'Config error', e);
        return cloneConfig(CONFIG);
      }
    },

    // Backward-compatible alias for config() (C5) — both names work.
    configure: function(options?: DeepPartial<AnalyticsConfig>) {
      return API.config(options);
    },

    consent: {
      grant: function(): void {
        consent.setConsent(true);
      },
      revoke: function(): void {
        consent.setConsent(false);
      },
      status: function(): boolean {
        return consent.isGranted();
      },
      // Lets the unified common-consent service know whether this module's gate
      // is armed; a disarmed gate must not override an explicit ppLib revoke().
      isRequired: function(): boolean {
        return consent.isRequired();
      }
    },

    track: function(eventName: string, properties?: Record<string, unknown>): void {
      tracker.track(eventName, properties);
    },

    getAttribution: function() {
      return tracker.getAttribution();
    },

    registerPlatform: function(name: string, handler: (data: Record<string, unknown>) => void): void {
      platforms.register(name, handler);
    },

    clear: function(): void {
      Storage.clear();
    },

    init: function(): void {
      tracker.init();
    }
  };

  // =====================================================
  // AUTO-INITIALIZATION
  // =====================================================

  try {
    /*! v8 ignore start */
    if (doc.readyState === 'loading') {
    /*! v8 ignore stop */
      doc.addEventListener('DOMContentLoaded', function() {
        tracker.init();
      });
    } else {
      tracker.init();
    }
  } catch (e) {
    utils.log('error', 'Fatal initialization error', e);
  }

  // =====================================================
  // EXPOSE API
  // =====================================================

  win.ppAnalytics = API;
  // Also expose under the unified ppLib namespace for IA consistency with
  // every other module (ppLib.datalayer, ppLib.mixpanel, ...). Same object.
  ppLib.analytics = API;

  /*! v8 ignore start */
  if (CONFIG.debug) {
    utils.log('info', 'API ready at window.ppAnalytics');

    win.ppAnalyticsDebug = {
      config: CONFIG,
      consent: consent,
      tracker: tracker,
      platforms: platforms,
      queue: eventQueue,
      session: session
    };
  }
  /*! v8 ignore stop */

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
