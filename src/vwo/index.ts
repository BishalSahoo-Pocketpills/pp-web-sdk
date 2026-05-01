/**
 * pp-analytics-lib: VWO Module
 * Visual Website Optimizer integration — A/B tests, redirect tests, feature flags.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.vwo
 */
import type { PPLib } from '@src/types/common.types';
import type { VWOConfig, VWOExperiment } from '@src/types/vwo.types';
import { createVWOConfig } from '@src/vwo/config';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VWOConfig = createVWOConfig();

  // =====================================================
  // SESSIONSTORAGE HELPERS
  // =====================================================

  function sessionStorageSet(key: string, value: string): void {
    try {
      win.sessionStorage.setItem(key, value);
    } catch (e) {
      ppLib.log('warn', '[ppVWO] Failed to write to sessionStorage');
    }
  }

  function sessionStorageGet(key: string): string | null {
    try {
      return win.sessionStorage.getItem(key);
    } catch (e) {
      ppLib.log('warn', '[ppVWO] Failed to read from sessionStorage');
      return null;
    }
  }

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

      if (paramValue) {
        var forced: Record<string, string> = {};
        var pairs = paramValue.split(',');
        for (var i = 0; i < pairs.length; i++) {
          var parts = pairs[i].split(':');
          if (parts.length === 2 && parts[0] && parts[1]) {
            forced[parts[0].trim()] = parts[1].trim();
          }
        }

        sessionStorageSet(CONFIG.sessionStorageKey, JSON.stringify(forced));
        return forced;
      }

      // Fall back to sessionStorage
      var stored = sessionStorageGet(CONFIG.sessionStorageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      ppLib.log('error', '[ppVWO] parseForcedVariations error', e);
    }

    return {};
  }

  /**
   * Create a queued callback for setting a forced variation in VWO.
   */
  function createSetCombinationFn(campaignId: string, variationId: string) {
    return function() {
      win._vis_opt_set_combination(parseInt(variationId, 10), parseInt(campaignId, 10));
    };
  }

  /**
   * Apply forced variations by pushing _vis_opt_set_combination calls
   * to VWO's internal queue.
   */
  function applyForcedVariations(): void {
    var forced = parseForcedVariations();
    var keys = Object.keys(forced);

    if (keys.length === 0) return;

    win._vis_opt_queue = win._vis_opt_queue || [];

    for (var i = 0; i < keys.length; i++) {
      win._vis_opt_queue.push(createSetCombinationFn(keys[i], forced[keys[i]]));
    }

    ppLib.log('info', '[ppVWO] Forced variations applied: ' + keys.length);
  }

  // =====================================================
  // SMARTCODE INJECTION
  // =====================================================

  /**
   * Create the VWO SmartCode object: anti-FOUC style + SDK script loader.
   * Extracted as a named factory so all methods live at initModule scope depth,
   * avoiding deeply nested anonymous closures that cause V8 coverage merge artifacts.
   */
  function createSmartCode(): typeof win._vwo_code {
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
        if (!f) {
          f = true;
          var a = d.getElementById('_vis_opt_path_hides');
          if (a && a.parentNode) {
            // Smooth fade-in instead of abrupt snap
            a.textContent = hide_element
              ? hide_element + '{transition:opacity .3s ease !important;opacity:1 !important;}'
              : '';
            // Clean up style element after transition completes
            win.setTimeout(function() {
              if (a && a.parentNode) {
                a.parentNode.removeChild(a);
              }
            }, 350);
          }
        }
      },
      finished: function() { return f; },
      code_loaded: function() {},
      load: function(scriptUrl: string) {
        var b = d.createElement('script');
        b.src = scriptUrl;
        b.type = 'text/javascript';
        if (CONFIG.nonce) b.setAttribute('nonce', CONFIG.nonce);
        b.onerror = function() {
          win._vwo_code.finish();
        };
        d.getElementsByTagName('head')[0].appendChild(b);
      },
      init: function() {
        var settings_timer = win.setTimeout(function() {
          win._vwo_code.finish();
        }, settings_tolerance);

        var a = d.createElement('style');
        var b = hide_element
          ? hide_element + '{opacity:0 !important;filter:alpha(opacity=0) !important;background:none !important;}'
          : '';
        var h = d.getElementsByTagName('head')[0];
        a.setAttribute('id', '_vis_opt_path_hides');
        a.setAttribute('type', 'text/css');
        a.appendChild(d.createTextNode(b));
        h.appendChild(a);

        this.load(CONFIG.smartCodeUrl + '?a=' + account_id +
          '&u=' + encodeURIComponent(d.URL) +
          '&f=' + (+is_spa) +
          '&r=' + Math.random());

        return settings_timer;
      }
    };

    win._vwo_settings_timer = code.init();
    return code;
  }

  /**
   * Inject VWO SmartCode if not already present.
   */
  function injectSmartCode(): void {
    win._vwo_code = createSmartCode();
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
      if (!vwoExp) return experiments;

      var ids = Object.keys(vwoExp);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var exp = vwoExp[id];

        if (!exp || !exp.combination_chosen) continue;

        var variationId = String(exp.combination_chosen);
        var variationName = '';

        // Resolve variation name from comb_n map
        if (exp.comb_n && exp.comb_n[variationId]) {
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
    var experiments = readExperiments();

    // Push to dataLayer (GA4/GTM)
    if (CONFIG.trackToDataLayer) {
      win.dataLayer = win.dataLayer || [];
      for (var i = 0; i < experiments.length; i++) {
        win.dataLayer.push({
          event: 'experiment_impression',
          experiment_id: experiments[i].campaignId,
          variation_id: experiments[i].variationId,
          variation_name: experiments[i].variationName
        });
      }
    }

    // Register as Mixpanel super properties so experiment data
    // appears on ALL subsequent events (page view, add to cart, purchase, etc.)
    // This complements VWO's native "VWO" event — that event fires once,
    // these super properties persist for the entire session.
    if (experiments.length > 0) {
      registerExperimentsToMixpanel(experiments);
      ppLib.log('info', '[ppVWO] Tracked ' + experiments.length + ' experiment(s) to dataLayer + Mixpanel');
    }
  }

  /**
   * Build VWO experiment properties and store on ppLib for cross-module access.
   * The Mixpanel module reads ppLib._vwoExperimentProps in its loaded callback
   * and registers them as super properties (guaranteed to be before any track calls).
   * Also stores in sessionStorage so experiments persist across page navigations.
   */
  function registerExperimentsToMixpanel(experiments: VWOExperiment[]): void {
    try {
      var props: Record<string, string> = {};
      var summaryParts: string[] = [];

      for (var i = 0; i < experiments.length; i++) {
        var exp = experiments[i];
        var label = exp.variationName || ('Variation ' + exp.variationId);
        summaryParts.push(exp.campaignId + ':' + label);
        props['vwo_campaign_' + exp.campaignId] = label;
      }
      props.vwo_experiments = summaryParts.join(', ');

      // Store on ppLib for Mixpanel module to read during its init
      ppLib._vwoExperimentProps = props;

      // Also persist in sessionStorage for SPA page navigations
      // (VWO may not re-fire _vis_opt_queue on subsequent pages)
      sessionStorageSet('pp_vwo_exp_props', JSON.stringify(props));

      // If Mixpanel is already fully loaded, register immediately
      var mp = (win as any).mixpanel;
      if (mp && mp.__loaded) {
        mp.register(props);
        if (mp.people && typeof mp.people.set === 'function') {
          mp.people.set(props);
        }
        ppLib.log('info', '[ppVWO] Registered experiments to Mixpanel (immediate)');
      } else {
        ppLib.log('info', '[ppVWO] Experiment props stored — Mixpanel will register on init');
      }
    } catch (e) {
      ppLib.log('warn', '[ppVWO] Failed to prepare experiment properties', e);
    }
  }

  // =====================================================
  // GOAL TRACKING (internal)
  // =====================================================

  function trackGoalInternal(goalId: number, revenue?: number): void {
    try {
      win.VWO = win.VWO || [];

      if (typeof revenue === 'number') {
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
  var domBound = false;

  function isDuplicateGoal(key: string): boolean {
    var now = Date.now();
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (var k in lastGoalMap) {
        if ((now - lastGoalMap[k]) >= CONFIG.debounceMs) {
          delete lastGoalMap[k];
        }
      }
    }
    if (lastGoalMap[key] && (now - lastGoalMap[key]) < CONFIG.debounceMs) {
      return true;
    }
    lastGoalMap[key] = now;
    return false;
  }

  function trackGoalFromElement(el: Element): void {
    var goalIdStr = (el.getAttribute(CONFIG.attributes.goal) || '').trim();
    if (!goalIdStr) return;

    var goalId = parseInt(goalIdStr, 10);
    if (isNaN(goalId)) return;

    var elId = (el.id || goalIdStr) + ':' + el.tagName;
    if (isDuplicateGoal(elId)) return;

    var revenueStr = (el.getAttribute(CONFIG.attributes.revenue) || '').trim();
    var revenue: number | undefined;
    if (revenueStr) {
      revenue = parseFloat(revenueStr);
      if (isNaN(revenue)) revenue = undefined;
    }

    trackGoalInternal(goalId, revenue);
  }

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

  function handleGoalSubmit(e: Event): void {
    try {
      var form = e.target as Element;
      if (!form) return;

      var el: Element | null = null;
      if (form.hasAttribute && form.hasAttribute(CONFIG.attributes.goal)) {
        el = form;
      } else if (form.closest) {
        el = form.closest('[' + CONFIG.attributes.goal + ']');
      }
      if (!el) return;

      var trigger = (el.getAttribute(CONFIG.attributes.trigger) || '').trim();
      if (trigger !== 'submit') return;

      trackGoalFromElement(el);
    } catch (err) {
      ppLib.log('error', '[ppVWO] handleGoalSubmit error', err);
    }
  }

  function scanViewGoals(): void {
    try {
      if (typeof win.IntersectionObserver === 'undefined') {
        ppLib.log('warn', '[ppVWO] IntersectionObserver not available for view triggers');
        return;
      }

      var selector = '[' + CONFIG.attributes.goal + '][' + CONFIG.attributes.trigger + '="view"]';
      var elements = doc.querySelectorAll(selector);
      if (elements.length === 0) return;

      // Disconnect previous observer if re-scanning
      if (viewObserver) {
        viewObserver.disconnect();
      }

      viewObserver = new win.IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            trackGoalFromElement(entries[i].target);
            viewObserver!.unobserve(entries[i].target);
          }
        }
      }, { threshold: 0.5 });

      for (var i = 0; i < elements.length; i++) {
        viewObserver.observe(elements[i]);
      }

      ppLib.log('info', '[ppVWO] Observing ' + elements.length + ' view-trigger element(s)');
    } catch (err) {
      ppLib.log('error', '[ppVWO] scanViewGoals error', err);
    }
  }

  function bindDOM(): void {
    if (domBound) return;
    domBound = true;
    doc.addEventListener('click', handleGoalClick, { capture: false, passive: true } as EventListenerOptions);
    doc.addEventListener('submit', handleGoalSubmit, { capture: false } as EventListenerOptions);
    scanViewGoals();
    ppLib.log('info', '[ppVWO] DOM binding initialized');
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    if (!CONFIG.enabled) {
      ppLib.log('info', '[ppVWO] Module disabled');
      return;
    }

    if (!CONFIG.accountId && !win._vwo_code) {
      ppLib.log('warn', '[ppVWO] No accountId configured. Call ppLib.vwo.configure({ accountId: "..." }) before init.');
      return;
    }

    // Apply forced variations before SmartCode loads
    applyForcedVariations();

    // Inject VWO SmartCode only if not already present (e.g. inline in HTML)
    if (win._vwo_code) {
      ppLib.log('info', '[ppVWO] SmartCode already present — skipping injection');
    } else {
      injectSmartCode();
    }

    // Track experiments — three strategies to handle VWO timing:
    // 1. Immediate: VWO already assigned variations (rare on first load)
    // 2. _vis_opt_queue: VWO hasn't loaded yet, will process queue later
    // 3. Polling: VWO loaded and drained queue before us, but hasn't
    //    set combination_chosen yet — poll until it appears
    var experimentsTracked = false;
    var experimentPollInterval: number | null = null;

    function tryTrackExperiments(): boolean {
      if (experimentsTracked) return true;
      if (readExperiments().length > 0) {
        trackExperiments();
        experimentsTracked = true;
        // Clean up polling if it was the queue callback that succeeded
        if (experimentPollInterval !== null) {
          win.clearInterval(experimentPollInterval);
          experimentPollInterval = null;
        }
        return true;
      }
      return false;
    }

    // Strategy 1: Try immediately
    tryTrackExperiments();

    // Strategy 2: Queue for VWO callback
    win._vis_opt_queue = win._vis_opt_queue || [];
    win._vis_opt_queue.push(function() {
      tryTrackExperiments();
    });

    // Strategy 3: Poll for combination_chosen (covers the gap where
    // VWO already drained the queue but hasn't assigned variations yet)
    if (!experimentsTracked) {
      var pollCount = 0;
      experimentPollInterval = win.setInterval(function() {
        pollCount++;
        if (tryTrackExperiments() || pollCount >= 30) {
          win.clearInterval(experimentPollInterval!);
          experimentPollInterval = null;
        }
      }, 500);
    }

    // Bind DOM for auto-tracking goals
    bindDOM();

    // Auto-enable VWO platform in event-source module
    if (ppLib.eventSource) {
      ppLib.eventSource.configure({ platforms: { vwo: { enabled: true } } } as any);
      ppLib.log('info', '[ppVWO] Auto-enabled VWO dispatcher in event-source');
    }

    ppLib.log('info', '[ppVWO] Initialized');
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.vwo = {
    configure: function(options?: Partial<VWOConfig>) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    getVariation: function(campaignId: string): string | null {
      try {
        var vwoExp = win._vwo_exp;
        if (!vwoExp || !vwoExp[campaignId]) return null;

        var exp = vwoExp[campaignId];
        if (!exp.combination_chosen) return null;

        return String(exp.combination_chosen);
      } catch (e) {
        ppLib.log('error', '[ppVWO] getVariation error', e);
        return null;
      }
    },

    getActiveExperiments: readExperiments,

    forceVariation: function(campaignId: string, variationId: string): void {
      try {
        var forced = parseForcedVariations();
        forced[campaignId] = variationId;

        sessionStorageSet(CONFIG.sessionStorageKey, JSON.stringify(forced));

        // Apply immediately via VWO queue
        win._vis_opt_queue = win._vis_opt_queue || [];
        win._vis_opt_queue.push(createSetCombinationFn(campaignId, forced[campaignId]));

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
        var vwoExp = win._vwo_exp;
        if (!vwoExp || !vwoExp[campaignId]) return false;

        var exp = vwoExp[campaignId];
        if (!exp.combination_chosen) return false;

        // Variation 1 is control (feature disabled), anything else is enabled
        return exp.combination_chosen !== 1 && String(exp.combination_chosen) !== '1';
      } catch (e) {
        ppLib.log('error', '[ppVWO] isFeatureEnabled error', e);
        return false;
      }
    },

    getConfig: function() {
      return JSON.parse(JSON.stringify(CONFIG));
    }
  };

  ppLib.log('info', '[ppVWO] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }

})(window, document);
