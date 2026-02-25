/**
 * pp-analytics-lib: Ecommerce Tracking Module v1.0.0
 * Data-attribute-driven GA4 ecommerce events (view_item, add_to_cart).
 * No per-page inline scripts — just add data attributes to your HTML.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.ecommerce
 *
 * Usage (container pattern — attributes on parent, CTA nested inside):
 *   <section data-ecommerce-item="weight-loss"
 *            data-ecommerce-name="Weight Loss"
 *            data-ecommerce-price="60">
 *     <button data-event-source="add_to_cart">Start Assessment</button>
 *   </section>
 *
 * Usage (flat pattern — all attributes on the CTA itself):
 *   <button data-event-source="add_to_cart"
 *           data-ecommerce-item="weight-loss"
 *           data-ecommerce-name="Weight Loss"
 *           data-ecommerce-price="60">
 *     Start Assessment
 *   </button>
 *
 * Events fired:
 *   - view_item  → on page load, all [data-ecommerce-item] elements
 *   - add_to_cart → on CTA click, resolved item from CTA or nearest ancestor
 *
 * Both events go to GTM (dataLayer) and Mixpanel.
 */
(function(window, document, undefined) {
  'use strict';

  function initModule(ppLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  var CONFIG = {
    // Default item field values
    defaults: {
      brand: 'PocketPills',
      category: 'Telehealth',
      currency: 'CAD',
      quantity: 1
    },

    // Data attribute names
    attributes: {
      item: 'data-ecommerce-item',
      name: 'data-ecommerce-name',
      price: 'data-ecommerce-price',
      category: 'data-ecommerce-category',
      brand: 'data-ecommerce-brand',
      variant: 'data-ecommerce-variant',
      discount: 'data-ecommerce-discount',
      coupon: 'data-ecommerce-coupon'
    },

    // CTA selector — clicks on these trigger add_to_cart
    ctaSelector: '[data-event-source="add_to_cart"]',

    // Debounce window to prevent duplicate click+touchend firing (ms)
    debounceMs: 300,

    // Platforms to send events to
    platforms: {
      mixpanel: { enabled: true },
      gtm: { enabled: true }
    }
  };

  // =====================================================
  // DEBOUNCE TRACKER
  // =====================================================

  var lastEventMap = {};

  function isDuplicate(key) {
    var now = Date.now();
    if (lastEventMap[key] && (now - lastEventMap[key]) < CONFIG.debounceMs) {
      return true;
    }
    lastEventMap[key] = now;
    return false;
  }

  function getElementKey(el) {
    var item = el.getAttribute(CONFIG.attributes.item) || '';
    var tag = el.tagName || '';
    var text = (el.innerText || '').substring(0, 50).trim();
    return tag + ':' + item + ':' + text;
  }

  // =====================================================
  // ITEM DATA EXTRACTION
  // =====================================================

  /**
   * Parse ecommerce item data from an element's data attributes.
   * Returns null if required attributes (item, name, price) are missing.
   */
  function parseItem(el) {
    if (!el) return null;

    var attrs = CONFIG.attributes;
    var itemId = el.getAttribute(attrs.item);
    var itemName = el.getAttribute(attrs.name);
    var itemPrice = el.getAttribute(attrs.price);

    // All three required
    if (!itemId || !itemName || !itemPrice) return null;

    var item = {
      item_id: ppLib.Security.sanitize(itemId),
      item_name: ppLib.Security.sanitize(itemName),
      item_brand: ppLib.Security.sanitize(el.getAttribute(attrs.brand) || CONFIG.defaults.brand),
      item_category: ppLib.Security.sanitize(el.getAttribute(attrs.category) || CONFIG.defaults.category),
      price: ppLib.Security.sanitize(itemPrice),
      quantity: CONFIG.defaults.quantity
    };

    // Optional fields — only include if present
    var variant = el.getAttribute(attrs.variant);
    if (variant) item.variant = ppLib.Security.sanitize(variant);

    var discount = el.getAttribute(attrs.discount);
    if (discount) item.discount = ppLib.Security.sanitize(discount);

    var coupon = el.getAttribute(attrs.coupon);
    if (coupon) item.coupon = ppLib.Security.sanitize(coupon);

    return item;
  }

  /**
   * Scan the DOM for all [data-ecommerce-item] elements and return parsed items.
   */
  function getItemsFromDOM() {
    var elements = document.querySelectorAll('[' + CONFIG.attributes.item + ']');
    var items = [];

    for (var i = 0; i < elements.length; i++) {
      var item = parseItem(elements[i]);
      if (item) items.push(item);
    }

    return items;
  }

  /**
   * Resolve item data for a CTA click.
   * Checks the CTA element itself first, then walks up to find a
   * [data-ecommerce-item] ancestor (container pattern).
   */
  function resolveItemForCTA(ctaEl) {
    // Flat pattern: attributes directly on the CTA
    var item = parseItem(ctaEl);
    if (item) return item;

    // Container pattern: find nearest ancestor with data-ecommerce-item
    var container = ctaEl.closest('[' + CONFIG.attributes.item + ']');
    if (container) return parseItem(container);

    return null;
  }

  // =====================================================
  // BUILD ECOMMERCE DATA
  // =====================================================

  function buildEcommerceData(items) {
    if (!items || items.length === 0) return null;

    // Calculate total value from all items
    var totalValue = 0;
    for (var i = 0; i < items.length; i++) {
      var price = parseFloat(items[i].price);
      if (!isNaN(price)) {
        totalValue += price * (items[i].quantity || 1);
      }
    }

    return {
      value: String(totalValue),
      currency: CONFIG.defaults.currency,
      items: items
    };
  }

  // =====================================================
  // EVENT DISPATCHERS
  // =====================================================

  function sendToGTM(eventName, ecommerceData) {
    try {
      if (!CONFIG.platforms.gtm.enabled) return;

      window.dataLayer = window.dataLayer || [];

      // GA4 best practice: clear previous ecommerce data
      window.dataLayer.push({ ecommerce: null });
      window.dataLayer.push({
        event: eventName,
        ecommerce: ecommerceData
      });

      ppLib.log('info', '[ppEcommerce] GTM → ' + eventName, ecommerceData);
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] GTM send error', e);
    }
  }

  function sendToMixpanel(eventName, ecommerceData) {
    try {
      if (!CONFIG.platforms.mixpanel.enabled) return;
      if (!window.mixpanel || !window.mixpanel.track) return;

      window.mixpanel.track(eventName, ecommerceData);
      ppLib.log('info', '[ppEcommerce] Mixpanel → ' + eventName, ecommerceData);
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] Mixpanel send error', e);
    }
  }

  function dispatchEvent(eventName, ecommerceData) {
    sendToGTM(eventName, ecommerceData);
    sendToMixpanel(eventName, ecommerceData);
  }

  // =====================================================
  // VIEW_ITEM — fires on page load
  // =====================================================

  function trackViewItem() {
    try {
      var items = getItemsFromDOM();
      if (items.length === 0) {
        ppLib.log('verbose', '[ppEcommerce] No ecommerce items found on page');
        return;
      }

      var ecommerceData = buildEcommerceData(items);
      if (!ecommerceData) return;

      dispatchEvent('view_item', ecommerceData);
      ppLib.log('info', '[ppEcommerce] view_item fired with ' + items.length + ' item(s)');
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] trackViewItem error', e);
    }
  }

  // =====================================================
  // ADD_TO_CART — fires on CTA click
  // =====================================================

  function handleInteraction(e) {
    try {
      var target = e.target;
      var cta = target.closest(CONFIG.ctaSelector);

      if (!cta) return;

      // Debounce to prevent duplicate click + touchend
      var key = getElementKey(cta);
      if (isDuplicate(key)) return;

      var item = resolveItemForCTA(cta);
      if (!item) {
        ppLib.log('verbose', '[ppEcommerce] CTA clicked but no ecommerce data found');
        return;
      }

      var ecommerceData = buildEcommerceData([item]);
      if (!ecommerceData) return;

      dispatchEvent('add_to_cart', ecommerceData);
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] handleInteraction error', e);
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init() {
    try {
      // Event delegation for add_to_cart clicks
      document.addEventListener('click', handleInteraction, { capture: false, passive: true });
      document.addEventListener('touchend', handleInteraction, { capture: false, passive: true });

      // Defer view_item to window load so all analytics deps (Mixpanel, GTM)
      // are fully initialized. During defer execution, Mixpanel isn't ready yet
      // because its init runs in a DOMContentLoaded handler.
      if (document.readyState === 'complete') {
        trackViewItem();
      } else {
        window.addEventListener('load', trackViewItem);
      }

      ppLib.log('info', '[ppEcommerce] Initialized');
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] init error', e);
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

  ppLib.ecommerce = {
    /**
     * Override default config (brand, category, currency, attribute names, etc.)
     */
    configure: function(options) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    /**
     * Re-fire view_item by re-scanning the DOM.
     * Useful after dynamically adding ecommerce elements.
     */
    trackViewItem: trackViewItem,

    /**
     * Programmatically fire add_to_cart for a given item.
     * @param {Object} itemData - { item_id, item_name, price, ... }
     */
    trackItem: function(itemData) {
      if (!itemData || !itemData.item_id || !itemData.item_name || !itemData.price) {
        ppLib.log('error', '[ppEcommerce] trackItem requires item_id, item_name, and price');
        return;
      }

      var item = {
        item_id: ppLib.Security.sanitize(itemData.item_id),
        item_name: ppLib.Security.sanitize(itemData.item_name),
        item_brand: ppLib.Security.sanitize(itemData.item_brand || CONFIG.defaults.brand),
        item_category: ppLib.Security.sanitize(itemData.item_category || CONFIG.defaults.category),
        price: ppLib.Security.sanitize(String(itemData.price)),
        quantity: itemData.quantity || CONFIG.defaults.quantity
      };

      if (itemData.variant) item.variant = ppLib.Security.sanitize(itemData.variant);
      if (itemData.discount) item.discount = ppLib.Security.sanitize(String(itemData.discount));
      if (itemData.coupon) item.coupon = ppLib.Security.sanitize(itemData.coupon);

      var ecommerceData = buildEcommerceData([item]);
      if (ecommerceData) {
        dispatchEvent('add_to_cart', ecommerceData);
      }
    },

    /**
     * Return parsed items currently in the DOM.
     */
    getItems: function() {
      return getItemsFromDOM();
    },

    /**
     * Return current config.
     */
    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppEcommerce] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available
  if (window.ppLib && window.ppLib._isReady) {
    initModule(window.ppLib);
  } else {
    window.ppLibReady = window.ppLibReady || [];
    window.ppLibReady.push(initModule);
  }

})(window, document);
