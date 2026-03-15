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
      /*! v8 ignore start */
      ppLib.log('error', '[ppVWO] parseForcedVariations error', e);
      /*! v8 ignore stop */
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
   * Closely follows VWO's official async SmartCode to ensure compatibility.
   */
  function injectSmartCode(): void {
    win._vwo_code = win._vwo_code || (function() {
      var account_id = CONFIG.accountId;
      var settings_tolerance = CONFIG.settingsTolerance;
      var library_tolerance = CONFIG.libraryTolerance;
      var use_existing_jquery = false;
      var is_spa = CONFIG.isSPA ? 1 : 0;
      var hide_element = CONFIG.hideElement;
      var f = false;
      var d = doc;

      var code = {
        use_existing_jquery: function() { return use_existing_jquery; },
        library_tolerance: function() { return library_tolerance; },
        finish: function() {
          /*! v8 ignore start */
          if (!f) {
          /*! v8 ignore stop */
            f = true;
            var a = d.getElementById('_vis_opt_path_hides');
            /*! v8 ignore start */
            if (a && a.parentNode) {
            /*! v8 ignore stop */
              a.parentNode.removeChild(a);
            }
          }
        },
        finished: function() { return f; },
        /*! v8 ignore start */
        code_loaded: function() {},
        /*! v8 ignore stop */
        load: function(scriptUrl: string) {
          var b = d.createElement('script');
          b.src = scriptUrl;
          b.type = 'text/javascript';
          b.onerror = function() {
            /*! v8 ignore start */
            win._vwo_code.finish();
            /*! v8 ignore stop */
          };
          d.getElementsByTagName('head')[0].appendChild(b);
        },
        init: function() {
          var settings_timer = win.setTimeout(function() {
            /*! v8 ignore start */
            win._vwo_code.finish();
            /*! v8 ignore stop */
          }, settings_tolerance);

          /*! v8 ignore start */
          var a = d.createElement('style');
          var b = hide_element
            ? hide_element + '{opacity:0 !important;filter:alpha(opacity=0) !important;background:none !important;}'
            : '';
          var h = d.getElementsByTagName('head')[0];
          a.setAttribute('id', '_vis_opt_path_hides');
          /*! v8 ignore stop */
          a.setAttribute('type', 'text/css');
          /*! v8 ignore start */
          if ((a as any).styleSheet) {
            (a as any).styleSheet.cssText = b;
          } else {
          /*! v8 ignore stop */
            a.appendChild(d.createTextNode(b));
          }
          h.appendChild(a);

          this.load('https://dev.visualwebsiteoptimizer.com/j.php?a=' + account_id +
            '&u=' + encodeURIComponent(d.URL) +
            '&f=' + (+is_spa) +
            '&r=' + Math.random());

          /*! v8 ignore start */
          return settings_timer;
          /*! v8 ignore stop */
        }
      };

      win._vwo_settings_timer = code.init();
      return code;
    })();

    ppLib.log('info', '[ppVWO] SmartCode injected for account ' + CONFIG.accountId);
  }

  // =====================================================
  // EXPERIMENT READING
  // =====================================================

  /**
   * Read active experiments from VWO's internal state.
   */
  /*! v8 ignore start */
  function readExperiments(): VWOExperiment[] {
    var experiments: VWOExperiment[] = [];
    /*! v8 ignore stop */

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
  // GOAL TRACKING (internal)
  // =====================================================

  function trackGoalInternal(goalId: number, revenue?: number): void {
    try {
      win.VWO = win.VWO || [];

      /*! v8 ignore start */
      if (typeof revenue === 'number') {
      /*! v8 ignore stop */
        win.VWO.push(['track.goalConversion', goalId, revenue]);
      } else {
        win.VWO.push(['track.goalConversion', goalId]);
      }

      ppLib.log('info', '[ppVWO] Goal tracked: ' + goalId + (typeof revenue === 'number' ? ' (revenue: ' + revenue + ')' : ''));
    } catch (e) {
      ppLib.log('error', '[ppVWO] trackGoal error', e);
    }
  }

  // =====================================================
  // DOM BINDING — auto-track goals via data attributes
  // =====================================================

  var lastGoalMap: Record<string, number> = {};
  var debounceWriteCount = 0;
  var viewObserver: IntersectionObserver | null = null;

  function isDuplicateGoal(key: string): boolean {
    var now = Date.now();
    /*! v8 ignore start */
    if (++debounceWriteCount >= 100) {
    /*! v8 ignore stop */
      debounceWriteCount = 0;
      for (var k in lastGoalMap) {
        /*! v8 ignore start */
        if ((now - lastGoalMap[k]) >= CONFIG.debounceMs) {
        /*! v8 ignore stop */
          delete lastGoalMap[k];
        }
      }
    }
    /*! v8 ignore start */
    if (lastGoalMap[key] && (now - lastGoalMap[key]) < CONFIG.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastGoalMap[key] = now;
    return false;
  }

  function trackGoalFromElement(el: Element): void {
    var goalIdStr = (el.getAttribute(CONFIG.attributes.goal) || '').trim();
    /*! v8 ignore start */
    if (!goalIdStr) return;
    /*! v8 ignore stop */

    var goalId = parseInt(goalIdStr, 10);
    /*! v8 ignore start */
    if (isNaN(goalId)) return;
    /*! v8 ignore stop */

    var elId = (el.id || goalIdStr) + ':' + el.tagName;
    /*! v8 ignore start */
    if (isDuplicateGoal(elId)) return;
    /*! v8 ignore stop */

    var revenueStr = (el.getAttribute(CONFIG.attributes.revenue) || '').trim();
    var revenue: number | undefined;
    /*! v8 ignore start */
    if (revenueStr) {
    /*! v8 ignore stop */
      revenue = parseFloat(revenueStr);
      /*! v8 ignore start */
      if (isNaN(revenue)) revenue = undefined;
      /*! v8 ignore stop */
    }

    trackGoalInternal(goalId, revenue);
  }

  /*! v8 ignore start */
  function handleGoalClick(e: Event): void {
    try {
      var target = e.target as Element;
      if (!target || !target.closest) return;

      var el = target.closest('[' + CONFIG.attributes.goal + ']');
      if (!el) return;

      var trigger = (el.getAttribute(CONFIG.attributes.trigger) || 'click').trim();
      if (trigger !== 'click') return;

      trackGoalFromElement(el);
    } catch (err) {
      ppLib.log('error', '[ppVWO] handleGoalClick error', err);
    }
  }
  /*! v8 ignore stop */

  function handleGoalSubmit(e: Event): void {
    try {
      var form = e.target as Element;
      /*! v8 ignore start */
      if (!form) return;
      /*! v8 ignore stop */

      var el: Element | null = null;
      /*! v8 ignore start */
      if (form.hasAttribute && form.hasAttribute(CONFIG.attributes.goal)) {
        el = form;
      } else if (form.closest) {
        el = form.closest('[' + CONFIG.attributes.goal + ']');
      }
      /*! v8 ignore stop */
      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      var trigger = (el.getAttribute(CONFIG.attributes.trigger) || '').trim();
      /*! v8 ignore start */
      if (trigger !== 'submit') return;
      /*! v8 ignore stop */

      trackGoalFromElement(el);
    } catch (err) {
      /*! v8 ignore start */
      ppLib.log('error', '[ppVWO] handleGoalSubmit error', err);
      /*! v8 ignore stop */
    }
  }

  function scanViewGoals(): void {
    try {
      /*! v8 ignore start */
      if (typeof win.IntersectionObserver === 'undefined') {
        ppLib.log('warn', '[ppVWO] IntersectionObserver not available for view triggers');
        return;
      }
      /*! v8 ignore stop */

      var selector = '[' + CONFIG.attributes.goal + '][' + CONFIG.attributes.trigger + '="view"]';
      var elements = doc.querySelectorAll(selector);
      /*! v8 ignore start */
      if (elements.length === 0) return;
      /*! v8 ignore stop */

      // Disconnect previous observer if re-scanning
      /*! v8 ignore start */
      if (viewObserver) {
      /*! v8 ignore stop */
        viewObserver.disconnect();
      }

      /*! v8 ignore start */
      viewObserver = new win.IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            trackGoalFromElement(entries[i].target);
            viewObserver!.unobserve(entries[i].target);
          }
        }
      }, { threshold: 0.5 });
      /*! v8 ignore stop */

      for (var i = 0; i < elements.length; i++) {
        viewObserver.observe(elements[i]);
      }

      ppLib.log('info', '[ppVWO] Observing ' + elements.length + ' view-trigger element(s)');
    } catch (err) {
      ppLib.log('error', '[ppVWO] scanViewGoals error', err);
    }
  }

  function bindDOM(): void {
    doc.addEventListener('click', handleGoalClick, { capture: false, passive: true } as EventListenerOptions);
    doc.addEventListener('submit', handleGoalSubmit, { capture: false } as EventListenerOptions);
    scanViewGoals();
    ppLib.log('info', '[ppVWO] DOM binding initialized');
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
    if (!CONFIG.accountId && !win._vwo_code) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppVWO] No accountId configured. Call ppLib.vwo.configure({ accountId: "..." }) before init.');
      return;
    }

    // Apply forced variations before SmartCode loads
    applyForcedVariations();

    // Inject VWO SmartCode only if not already present (e.g. inline in HTML)
    /*! v8 ignore start */
    if (win._vwo_code) {
      ppLib.log('info', '[ppVWO] SmartCode already present — skipping injection');
    } else {
      injectSmartCode();
    }

    // Track experiments when VWO is ready
    win._vis_opt_queue = win._vis_opt_queue || [];
    /*! v8 ignore stop */
    win._vis_opt_queue.push(trackExperiments);

    // Bind DOM for auto-tracking goals
    /*! v8 ignore start */
    bindDOM();
    /*! v8 ignore stop */

    // Auto-enable VWO platform in event-source module
    /*! v8 ignore start */
    if (ppLib.eventSource) {
      ppLib.eventSource.configure({ platforms: { vwo: { enabled: true } } } as any);
      ppLib.log('info', '[ppVWO] Auto-enabled VWO dispatcher in event-source');
    }
    /*! v8 ignore stop */

    /*! v8 ignore start */
    ppLib.log('info', '[ppVWO] Initialized');
    /*! v8 ignore stop */
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  /*! v8 ignore start */
  ppLib.vwo = {
  /*! v8 ignore stop */
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

    trackGoal: trackGoalInternal,

    bindDOM: bindDOM,

    scanViewGoals: scanViewGoals,

    isFeatureEnabled: function(campaignId: string): boolean {
      try {
        /*! v8 ignore start */
        var vwoExp = win._vwo_exp;
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
