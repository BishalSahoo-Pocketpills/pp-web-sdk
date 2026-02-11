/**
 * pp-analytics-lib: Event Source Tracking Module v1.0.0
 * Auto-tracks clicks and taps on interactive elements with data-event-source attribute.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.eventSource
 *
 * Usage:
 *   Add data-event-source="event_name" to any interactive element:
 *   <button data-event-source="signup_cta">Sign Up</button>
 *   <a href="/pricing" data-event-source="pricing_link">Pricing</a>
 *
 *   Optional attributes:
 *   - data-event-category="category"    → event category/group
 *   - data-event-label="label"          → custom label override
 *   - data-event-value="value"          → custom value
 *
 * Events are sent to:
 *   - Mixpanel (if window.mixpanel is available)
 *   - GTM/GA4 (via window.dataLayer)
 */
(function(window, document, undefined) {
  'use strict';

  var ppLib = window.ppLib;
  if (!ppLib) {
    console.error('[ppEventSource] common.js must be loaded first');
    return;
  }

  // =====================================================
  // CONFIGURATION
  // =====================================================

  var CONFIG = {
    attribute: 'data-event-source',
    categoryAttribute: 'data-event-category',
    labelAttribute: 'data-event-label',
    valueAttribute: 'data-event-value',

    // Debounce window to prevent duplicate click+touchend firing (ms)
    debounceMs: 300,

    // Platforms to send events to
    platforms: {
      mixpanel: { enabled: true },
      gtm: { enabled: true }
    },

    // GTM event name for tracked clicks
    gtmEventName: 'element_click',

    // Mixpanel event name for tracked clicks
    mixpanelEventName: 'Element Click',

    // Include page context in event properties
    includePageContext: true
  };

  // =====================================================
  // DEBOUNCE TRACKER
  // =====================================================

  var lastEventMap = {};

  function isDuplicate(elementId) {
    var now = Date.now();
    if (lastEventMap[elementId] && (now - lastEventMap[elementId]) < CONFIG.debounceMs) {
      return true;
    }
    lastEventMap[elementId] = now;
    return false;
  }

  function getElementId(el) {
    // Create a stable identifier for debounce purposes
    var source = el.getAttribute(CONFIG.attribute) || '';
    var tag = el.tagName || '';
    var text = (el.innerText || '').substring(0, 50).trim();
    return tag + ':' + source + ':' + text;
  }

  // =====================================================
  // EVENT DATA EXTRACTION
  // =====================================================

  function extractEventData(el) {
    var source = el.getAttribute(CONFIG.attribute);
    if (!source) return null;

    var sanitizedSource = ppLib.Security.sanitize(source);
    if (!sanitizedSource) return null;

    var data = {
      event_source: sanitizedSource,
      element_tag: el.tagName.toLowerCase(),
      element_text: ppLib.Security.sanitize((el.innerText || '').substring(0, 100).trim()),
      element_href: ''
    };

    // Extract href for links
    if (el.tagName === 'A' && el.href) {
      data.element_href = ppLib.Security.sanitize(el.href);
    }

    // Optional attributes
    var category = el.getAttribute(CONFIG.categoryAttribute);
    if (category) {
      data.event_category = ppLib.Security.sanitize(category);
    }

    var label = el.getAttribute(CONFIG.labelAttribute);
    if (label) {
      data.event_label = ppLib.Security.sanitize(label);
    }

    var value = el.getAttribute(CONFIG.valueAttribute);
    if (value) {
      data.event_value = ppLib.Security.sanitize(value);
    }

    // Page context
    if (CONFIG.includePageContext) {
      data.page_url = window.location.href;
      data.page_path = window.location.pathname;
      data.page_title = document.title;
    }

    data.timestamp = new Date().toISOString();

    return data;
  }

  // =====================================================
  // EVENT DISPATCHERS
  // =====================================================

  function sendToMixpanel(data) {
    try {
      if (!CONFIG.platforms.mixpanel.enabled) return;
      if (!window.mixpanel || !window.mixpanel.track) return;

      window.mixpanel.track(CONFIG.mixpanelEventName, data);
      ppLib.log('verbose', '[ppEventSource] Sent to Mixpanel', data);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] Mixpanel send error', e);
    }
  }

  function sendToGTM(data) {
    try {
      if (!CONFIG.platforms.gtm.enabled) return;

      window.dataLayer = window.dataLayer || [];
      var gtmData = { event: CONFIG.gtmEventName };

      for (var key in data) {
        if (data.hasOwnProperty(key)) {
          gtmData[key] = data[key];
        }
      }

      window.dataLayer.push(gtmData);
      ppLib.log('verbose', '[ppEventSource] Sent to GTM', gtmData);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] GTM send error', e);
    }
  }

  function dispatchEvent(data) {
    sendToMixpanel(data);
    sendToGTM(data);
  }

  // =====================================================
  // EVENT HANDLER (DELEGATION)
  // =====================================================

  function handleInteraction(e) {
    try {
      // Walk up from target to find closest element with data-event-source
      var target = e.target;
      var el = target.closest('[' + CONFIG.attribute + ']');

      if (!el) return;

      // Debounce to prevent duplicate click + touchend
      var elId = getElementId(el);
      if (isDuplicate(elId)) return;

      var data = extractEventData(el);
      if (!data) return;

      data.interaction_type = e.type; // 'click' or 'touchend'

      dispatchEvent(data);
    } catch (e) {
      ppLib.log('error', '[ppEventSource] handleInteraction error', e);
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init() {
    try {
      // Use event delegation on document — handles dynamic elements automatically
      document.addEventListener('click', handleInteraction, { capture: false, passive: true });
      document.addEventListener('touchend', handleInteraction, { capture: false, passive: true });

      ppLib.log('info', '[ppEventSource] Initialized — listening for [' + CONFIG.attribute + '] interactions');
    } catch (e) {
      ppLib.log('error', '[ppEventSource] init error', e);
    }
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

  ppLib.eventSource = {
    configure: function(options) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: init,

    // Manually track an element interaction
    trackElement: function(element) {
      if (!element) return;
      var data = extractEventData(element);
      if (data) {
        data.interaction_type = 'manual';
        dispatchEvent(data);
      }
    },

    // Manually track a custom event through the same pipeline
    trackCustom: function(eventSource, properties) {
      var data = {
        event_source: ppLib.Security.sanitize(eventSource),
        element_tag: 'custom',
        element_text: '',
        timestamp: new Date().toISOString(),
        interaction_type: 'custom'
      };

      if (CONFIG.includePageContext) {
        data.page_url = window.location.href;
        data.page_path = window.location.pathname;
        data.page_title = document.title;
      }

      if (properties && typeof properties === 'object') {
        for (var key in properties) {
          if (properties.hasOwnProperty(key)) {
            data[key] = ppLib.Security.sanitize(String(properties[key]));
          }
        }
      }

      dispatchEvent(data);
    },

    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppEventSource] Module loaded');

})(window, document);
