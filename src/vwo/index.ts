/**
 * pp-analytics-lib: VWO Module v1.0.0
 * Visual Website Optimizer integration — A/B tests, redirect tests, feature flags.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.vwo
 */
import type { PPLib } from '../types/common.types';
import type { VWOConfig, VWOExperiment } from '../types/vwo.types';
import { createVWOConfig } from './config';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VWOConfig = createVWOConfig();

  // =====================================================
  // FORCED VARIATIONS
  // =====================================================

  /**
   * Parse forced variations from URL query param or sessionStorage.
   * Format: ?vwo=campaignId:variationId,campaignId:variationId
   * Persists to sessionStorage so forced variations survive page navigations.
   */
  function parseForcedVariations(): Record<string, string> {
    try {
      var paramValue = ppLib.getQueryParam(win.location.href, CONFIG.queryParam);

      /*! v8 ignore start */
      if (paramValue) {
      /*! v8 ignore stop */
        var forced: Record<string, string> = {};
        var pairs = paramValue.split(',');
        for (var i = 0; i < pairs.length; i++) {
          var parts = pairs[i].split(':');
          /*! v8 ignore start */
          if (parts.length === 2 && parts[0] && parts[1]) {
          /*! v8 ignore stop */
            forced[parts[0].trim()] = parts[1].trim();
          }
        }

        // Persist to sessionStorage
        try {
          win.sessionStorage.setItem(CONFIG.sessionStorageKey, JSON.stringify(forced));
        } catch (e) {
          ppLib.log('warn', '[ppVWO] Failed to persist forced variations to sessionStorage');
        }

        return forced;
      }

      // Fall back to sessionStorage
      try {
        var stored = win.sessionStorage.getItem(CONFIG.sessionStorageKey);
        /*! v8 ignore start */
        if (stored) {
          return JSON.parse(stored);
        }
        /*! v8 ignore stop */
      } catch (e) {
        ppLib.log('warn', '[ppVWO] Failed to read forced variations from sessionStorage');
      }
    } catch (e) {
      ppLib.log('error', '[ppVWO] parseForcedVariations error', e);
    }

    return {};
  }

  /**
   * Apply forced variations by pushing _vis_opt_set_combination calls
   * to VWO's internal queue.
   */
  /*! v8 ignore start */
  function applyForcedVariations(): void {
    var forced = parseForcedVariations();
    var keys = Object.keys(forced);

    if (keys.length === 0) return;

    win._vis_opt_queue = win._vis_opt_queue || [];

    for (var i = 0; i < keys.length; i++) {
      (function(campaignId: string, variationId: string) {
        win._vis_opt_queue.push(function() {
          win._vis_opt_set_combination(parseInt(variationId, 10), parseInt(campaignId, 10));
        });
      })(keys[i], forced[keys[i]]);
    }

    ppLib.log('info', '[ppVWO] Forced variations applied: ' + keys.length);
    /*! v8 ignore stop */
  }

  // =====================================================
  // SMARTCODE INJECTION
  // =====================================================

  /**
   * Inject VWO SmartCode: anti-FOUC style + SDK script loader.
   */
  function injectSmartCode(): void {
    // Anti-FOUC style
    var hideStyle = doc.createElement('style');
    hideStyle.id = 'vwo-anti-fouc';
    hideStyle.textContent = CONFIG.hideElement + ' { opacity: 0 !important; }';
    doc.head.appendChild(hideStyle);

    // Timeout to remove anti-FOUC if VWO doesn't load
    var hideTimeout = win.setTimeout(function() {
      var el = doc.getElementById('vwo-anti-fouc');
      /*! v8 ignore start */
      if (el && el.parentNode) {
      /*! v8 ignore stop */
        el.parentNode.removeChild(el);
      }
      ppLib.log('warn', '[ppVWO] SmartCode load timeout — anti-FOUC style removed');
    }, CONFIG.settingsTolerance);

    // VWO settings object
    win._vwo_code = (function() {
      var account_id = CONFIG.accountId;
      var settings_tolerance = CONFIG.settingsTolerance;
      var library_tolerance = CONFIG.libraryTolerance;
      var is_spa = CONFIG.isSPA ? 1 : 0;
      var hide_element = CONFIG.hideElement;

      return {
        use_existing_jquery: function() { return false; },
        library_tolerance: function() { return library_tolerance; },
        finish: function() {
          /*! v8 ignore start */
          if (!is_spa) {
          /*! v8 ignore stop */
            var el = doc.getElementById('vwo-anti-fouc');
            /*! v8 ignore start */
            if (el && el.parentNode) {
            /*! v8 ignore stop */
              el.parentNode.removeChild(el);
            }
          }
          win.clearTimeout(hideTimeout);
        },
        code_loaded: function() {},
        load: function(scriptUrl: string) {
          var script = doc.createElement('script');
          script.src = scriptUrl;
          script.type = 'text/javascript';
          script.async = true;
          doc.head.appendChild(script);
        },
        init: function() {
          var settingsUrl = 'https://dev.visualwebsiteoptimizer.com/j.php?a=' + account_id +
            '&u=' + encodeURIComponent(doc.URL) +
            '&r=' + Math.random();

          /*! v8 ignore start */
          if (is_spa) {
          /*! v8 ignore stop */
            settingsUrl += '&f=1';
          }

          this.load(settingsUrl);

          var self = this;
          win.setTimeout(function() {
            /*! v8 ignore start */
            if (typeof win._vwo_code !== 'undefined') {
            /*! v8 ignore stop */
              self.finish();
            }
          }, settings_tolerance);

          return settings_tolerance;
        }
      };
    })();

    win._vwo_code.init();
    ppLib.log('info', '[ppVWO] SmartCode injected for account ' + CONFIG.accountId);
  }

  // =====================================================
  // EXPERIMENT READING
  // =====================================================

  /**
   * Read active experiments from VWO's internal state.
   */
  function readExperiments(): VWOExperiment[] {
    var experiments: VWOExperiment[] = [];

    try {
      var vwoExp = win._vwo_exp;
      /*! v8 ignore start */
      if (!vwoExp) return experiments;
      /*! v8 ignore stop */

      var ids = Object.keys(vwoExp);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var exp = vwoExp[id];

        /*! v8 ignore start */
        if (!exp || !exp.combination_chosen) continue;
        /*! v8 ignore stop */

        var variationId = String(exp.combination_chosen);
        var variationName = '';

        // Resolve variation name from comb_n map
        /*! v8 ignore start */
        if (exp.comb_n && exp.comb_n[variationId]) {
        /*! v8 ignore stop */
          variationName = exp.comb_n[variationId];
        }

        experiments.push({
          campaignId: id,
          variationId: variationId,
          variationName: variationName
        });
      }
    } catch (e) {
      ppLib.log('error', '[ppVWO] readExperiments error', e);
    }

    return experiments;
  }

  // =====================================================
  // DATALAYER TRACKING
  // =====================================================

  /**
   * Push experiment_impression events to window.dataLayer.
   */
  function trackExperiments(): void {
    /*! v8 ignore start */
    if (!CONFIG.trackToDataLayer) return;
    /*! v8 ignore stop */

    var experiments = readExperiments();
    win.dataLayer = win.dataLayer || [];

    for (var i = 0; i < experiments.length; i++) {
      win.dataLayer.push({
        event: 'experiment_impression',
        experiment_id: experiments[i].campaignId,
        variation_id: experiments[i].variationId,
        variation_name: experiments[i].variationName
      });
    }

    /*! v8 ignore start */
    if (experiments.length > 0) {
    /*! v8 ignore stop */
      ppLib.log('info', '[ppVWO] Tracked ' + experiments.length + ' experiment(s) to dataLayer');
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    /*! v8 ignore start */
    if (!CONFIG.enabled) {
    /*! v8 ignore stop */
      ppLib.log('info', '[ppVWO] Module disabled');
      return;
    }

    /*! v8 ignore start */
    if (!CONFIG.accountId) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppVWO] No accountId configured. Call ppLib.vwo.configure({ accountId: "..." }) before init.');
      return;
    }

    // Apply forced variations before SmartCode loads
    applyForcedVariations();

    // Inject VWO SmartCode
    injectSmartCode();

    // Track experiments when VWO is ready
    win._vis_opt_queue = win._vis_opt_queue || [];
    win._vis_opt_queue.push(trackExperiments);

    ppLib.log('info', '[ppVWO] Initialized');
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.vwo = {
    configure: function(options?: Partial<VWOConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    getVariation: function(campaignId: string): string | null {
      try {
        var vwoExp = win._vwo_exp;
        /*! v8 ignore start */
        if (!vwoExp || !vwoExp[campaignId]) return null;
        /*! v8 ignore stop */

        var exp = vwoExp[campaignId];
        /*! v8 ignore start */
        if (!exp.combination_chosen) return null;
        /*! v8 ignore stop */

        return String(exp.combination_chosen);
      } catch (e) {
        ppLib.log('error', '[ppVWO] getVariation error', e);
        return null;
      }
    },

    getActiveExperiments: readExperiments,

    forceVariation: function(campaignId: string, variationId: string): void {
      try {
        // Store in sessionStorage
        var forced = parseForcedVariations();
        forced[campaignId] = variationId;

        try {
          win.sessionStorage.setItem(CONFIG.sessionStorageKey, JSON.stringify(forced));
        } catch (e) {
          ppLib.log('warn', '[ppVWO] Failed to persist forced variation');
        }

        // Apply immediately via VWO queue
        win._vis_opt_queue = win._vis_opt_queue || [];
        win._vis_opt_queue.push(function() {
          win._vis_opt_set_combination(parseInt(variationId, 10), parseInt(campaignId, 10));
        });

        ppLib.log('info', '[ppVWO] Forced variation: campaign ' + campaignId + ' → variation ' + variationId);
      } catch (e) {
        ppLib.log('error', '[ppVWO] forceVariation error', e);
      }
    },

    isFeatureEnabled: function(campaignId: string): boolean {
      try {
        var vwoExp = win._vwo_exp;
        /*! v8 ignore start */
        if (!vwoExp || !vwoExp[campaignId]) return false;
        /*! v8 ignore stop */

        var exp = vwoExp[campaignId];
        /*! v8 ignore start */
        if (!exp.combination_chosen) return false;
        /*! v8 ignore stop */

        // Variation 1 is control (feature disabled), anything else is enabled
        return exp.combination_chosen !== 1 && String(exp.combination_chosen) !== '1';
      } catch (e) {
        ppLib.log('error', '[ppVWO] isFeatureEnabled error', e);
        return false;
      }
    },

    /*! v8 ignore start */
    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppVWO] Module loaded');
  /*! v8 ignore stop */

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
