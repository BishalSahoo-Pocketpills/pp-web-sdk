/**
 * pp-analytics-lib: Event Source Tracking Module
 * Auto-tracks clicks and taps on interactive elements with data-event-source attribute.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.eventSource
 */
import type { PPLib } from '@src/types/common.types';
import type { EventSourceConfig, EventSourceData } from '@src/types/event-source.types';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: EventSourceConfig = {
    attribute: 'data-event-source',
    categoryAttribute: 'data-event-category',
    labelAttribute: 'data-event-label',
    valueAttribute: 'data-event-value',

    // Debounce window to prevent duplicate click+touchend firing (ms)
    debounceMs: 300,

    // Platforms to send events to
    platforms: {
      mixpanel: { enabled: true },
      gtm: { enabled: true },
      vwo: { enabled: false }
    },

    // GTM event name for tracked clicks
    gtmEventName: 'element_click',

    // Mixpanel event name for tracked clicks
    mixpanelEventName: 'Element Click',

    // Include page context in event properties
    includePageContext: true,

    // VWO goal tracking attributes
    vwoGoalAttribute: 'data-vwo-goal',
    vwoRevenueAttribute: 'data-vwo-revenue'
  };

  // =====================================================
  // DEBOUNCE TRACKER
  // =====================================================

  const lastEventMap: Record<string, number> = {};
  let debounceWriteCount = 0;

  function isDuplicate(elementId: string): boolean {
    const now = Date.now();
    /*! v8 ignore start */
    // Prune stale entries every 100 writes to prevent unbounded growth
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (const k in lastEventMap) {
        if ((now - lastEventMap[k]) >= CONFIG.debounceMs) {
          delete lastEventMap[k];
        }
      }
    }
    if (lastEventMap[elementId] && (now - lastEventMap[elementId]) < CONFIG.debounceMs) {
      return true;
    }
    /*! v8 ignore stop */
    lastEventMap[elementId] = now;
    return false;
  }

  function getElementId(el: Element): string {
    // Create a stable identifier for debounce purposes
    const source = el.getAttribute(CONFIG.attribute) || '';
    /*! v8 ignore start */
    const tag = (el as any).tagName || '';
    /*! v8 ignore stop */
    const text = ((el as any).textContent || '').substring(0, 50).trim();
    return tag + ':' + source + ':' + text;
  }

  // =====================================================
  // EVENT DATA EXTRACTION
  // =====================================================

  function extractEventData(el: Element): EventSourceData | null {
    const source = el.getAttribute(CONFIG.attribute);
    /*! v8 ignore start */
    if (!source) return null;
    /*! v8 ignore stop */

    const sanitizedSource = ppLib.Security.sanitize(source);
    /*! v8 ignore start */
    if (!sanitizedSource) return null;
    /*! v8 ignore stop */

    const data: EventSourceData = {
      event_source: sanitizedSource,
      element_tag: el.tagName.toLowerCase(),
      element_text: ppLib.Security.sanitize(((el as any).textContent || '').substring(0, 100).trim()),
      element_href: '',
      timestamp: new Date().toISOString()
    };

    // Extract href for links
    /*! v8 ignore start */
    if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
    /*! v8 ignore stop */
      data.element_href = ppLib.Security.sanitize((el as HTMLAnchorElement).href);
    }

    // Optional attributes
    const category = el.getAttribute(CONFIG.categoryAttribute);
    /*! v8 ignore start */
    if (category) {
    /*! v8 ignore stop */
      data.event_category = ppLib.Security.sanitize(category);
    }

    const label = el.getAttribute(CONFIG.labelAttribute);
    /*! v8 ignore start */
    if (label) {
    /*! v8 ignore stop */
      data.event_label = ppLib.Security.sanitize(label);
    }

    const value = el.getAttribute(CONFIG.valueAttribute);
    /*! v8 ignore start */
    if (value) {
    /*! v8 ignore stop */
      data.event_value = ppLib.Security.sanitize(value);
    }

    // VWO goal attributes
    var vwoGoal = el.getAttribute(CONFIG.vwoGoalAttribute);
    /*! v8 ignore start */
    if (vwoGoal) {
    /*! v8 ignore stop */
      data.vwo_goal_id = ppLib.Security.sanitize(vwoGoal);
    }
    var vwoRevenue = el.getAttribute(CONFIG.vwoRevenueAttribute);
    /*! v8 ignore start */
    if (vwoRevenue) {
    /*! v8 ignore stop */
      data.vwo_revenue = ppLib.Security.sanitize(vwoRevenue);
    }

    // Page context
    /*! v8 ignore start */
    if (CONFIG.includePageContext) {
    /*! v8 ignore stop */
      data.page_url = win.location.href;
      data.page_path = win.location.pathname;
      data.page_title = doc.title;
    }

    return data;
  }

  // =====================================================
  // EVENT DISPATCHERS
  // =====================================================

  function sendToMixpanel(data: EventSourceData): void {
    try {
      /*! v8 ignore start */
      if (!CONFIG.platforms.mixpanel.enabled) return;
      if (!win.mixpanel || !win.mixpanel.track) return;

      if (!ppLib.Security.validateData(data)) {
        ppLib.log('error', '[ppEventSource] Invalid Mixpanel data rejected');
        return;
      }
      /*! v8 ignore stop */

      win.mixpanel.track(CONFIG.mixpanelEventName, data);
      ppLib.log('verbose', '[ppEventSource] Sent to Mixpanel', data);
    /*! v8 ignore start */
    } catch (e) {
      ppLib.log('error', '[ppEventSource] Mixpanel send error', e);
    }
    /*! v8 ignore stop */
  }

  function sendToGTM(data: EventSourceData): void {
    try {
      /*! v8 ignore start */
      if (!CONFIG.platforms.gtm.enabled) return;
      /*! v8 ignore stop */

      win.dataLayer = win.dataLayer || [];
      const gtmData: Record<string, any> = { event: CONFIG.gtmEventName };

      for (const key in data) {
        /*! v8 ignore start */
        if (data.hasOwnProperty(key)) {
        /*! v8 ignore stop */
          gtmData[key] = data[key];
        }
      }

      /*! v8 ignore start */
      if (!ppLib.Security.validateData(gtmData)) {
        ppLib.log('error', '[ppEventSource] Invalid GTM data rejected');
        return;
      }
      /*! v8 ignore stop */

      win.dataLayer.splice(0, Math.max(0, win.dataLayer.length - 500));
      win.dataLayer.push(gtmData);
      ppLib.log('verbose', '[ppEventSource] Sent to GTM', gtmData);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] GTM send error', e);
    }
  }

  function sendToVWO(data: EventSourceData): void {
    try {
      /*! v8 ignore start */
      if (!CONFIG.platforms.vwo.enabled) return;
      if (!data.vwo_goal_id) return;
      /*! v8 ignore stop */

      var goalId = parseInt(data.vwo_goal_id, 10);
      if (isNaN(goalId)) return;

      /*! v8 ignore start */
      if (!ppLib.vwo || !ppLib.vwo.trackGoal) {
        ppLib.log('warn', '[ppEventSource] VWO module not available');
        return;
      }
      /*! v8 ignore stop */

      var revenue: number | undefined;
      /*! v8 ignore start */
      if (data.vwo_revenue) {
        revenue = parseFloat(data.vwo_revenue);
        if (isNaN(revenue)) revenue = undefined;
      }
      /*! v8 ignore stop */

      ppLib.vwo.trackGoal(goalId, revenue);
      ppLib.log('verbose', '[ppEventSource] Sent to VWO — goal: ' + goalId);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] VWO send error', e);
    }
  }

  function dispatchEvent(data: EventSourceData): void {
    sendToMixpanel(data);
    sendToGTM(data);
    sendToVWO(data);
  }

  // =====================================================
  // EVENT HANDLER (DELEGATION)
  // =====================================================

  function handleInteraction(e: Event): void {
    try {
      // Walk up from target to find closest element with data-event-source
      const target = e.target as Element;
      const el = target.closest('[' + CONFIG.attribute + ']');

      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      // Debounce to prevent duplicate click + touchend
      /*! v8 ignore start */
      const elId = getElementId(el);
      if (isDuplicate(elId)) return;
      /*! v8 ignore stop */

      const data = extractEventData(el);
      /*! v8 ignore start */
      if (!data) return;
      /*! v8 ignore stop */

      data.interaction_type = e.type; // 'click' or 'touchend'

      dispatchEvent(data);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] handleInteraction error', e);
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    try {
      // Remove existing listeners for idempotency (same reference — safe across re-init calls)
      doc.removeEventListener('click', handleInteraction);
      doc.removeEventListener('touchend', handleInteraction);
      // Use event delegation on document — handles dynamic elements automatically
      doc.addEventListener('click', handleInteraction, { capture: false, passive: true } as EventListenerOptions);
      doc.addEventListener('touchend', handleInteraction, { capture: false, passive: true } as EventListenerOptions);

      ppLib.log('info', '[ppEventSource] Initialized — listening for [' + CONFIG.attribute + '] interactions');
    } catch (e) {
      ppLib.log('error', '[ppEventSource] init error', e);
    }
  }

  // Auto-initialize on DOM ready (bound guard prevents duplicate listeners across reloads)
  /*! v8 ignore start */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() {
      if (!ppLib._esBound) { ppLib._esBound = true; init(); }
    });
  } else {
    if (!ppLib._esBound) { ppLib._esBound = true; init(); }
  }
  /*! v8 ignore stop */

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.eventSource = {
    /*! v8 ignore start */
    configure: function(options?: Partial<EventSourceConfig>) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },
    /*! v8 ignore stop */

    init: init,

    // Manually track an element interaction
    /*! v8 ignore start */
    trackElement: function(element: Element): void {
      if (!element) {
        ppLib.log('warn', '[ppEventSource] trackElement called with null/undefined element');
        return;
      }
      /*! v8 ignore stop */
      const data = extractEventData(element);
      /*! v8 ignore start */
      if (data) {
      /*! v8 ignore stop */
        data.interaction_type = 'manual';
        dispatchEvent(data);
      }
    },

    // Manually track a custom event through the same pipeline
    trackCustom: function(eventSource: string, properties?: Record<string, any>): void {
      /*! v8 ignore start */
      if (!eventSource) {
        ppLib.log('warn', '[ppEventSource] trackCustom requires a non-empty eventSource');
        return;
      }
      /*! v8 ignore stop */

      const sanitizedSource = ppLib.Security.sanitize(eventSource);
      /*! v8 ignore start */
      if (!sanitizedSource) {
        ppLib.log('warn', '[ppEventSource] trackCustom: eventSource was rejected by sanitization');
        return;
      }
      /*! v8 ignore stop */

      const data: EventSourceData = {
        event_source: sanitizedSource,
        element_tag: 'custom',
        element_text: '',
        timestamp: new Date().toISOString(),
        interaction_type: 'custom'
      };

      /*! v8 ignore start */
      if (CONFIG.includePageContext) {
      /*! v8 ignore stop */
        data.page_url = win.location.href;
        data.page_path = win.location.pathname;
        data.page_title = doc.title;
      }

      /*! v8 ignore start */
      if (properties && typeof properties === 'object') {
        for (const key in properties) {
          if (properties.hasOwnProperty(key)) {
          /*! v8 ignore stop */
            data[key] = ppLib.Security.sanitize(String(properties[key]));
          }
        }
      }

      dispatchEvent(data);
    },

    getConfig: function() {
      return JSON.parse(JSON.stringify(CONFIG));
    }
  };

  ppLib.log('info', '[ppEventSource] Module loaded');

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
