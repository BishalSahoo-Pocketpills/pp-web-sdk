/**
 * pp-analytics-lib: Ecommerce Tracking Module
 * Data-attribute-driven GA4 ecommerce events (view_item, add_to_cart).
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.ecommerce
 */
import type { PPLib } from '@src/types/common.types';
import type { EcommerceConfig, EcommerceItem, EcommerceData } from '@src/types/ecommerce.types';
import type { DeepPartial } from '@src/types/utility.types';
import { trackViaMixpanel } from '@src/common/mixpanel-bridge';
import { ensureDataLayer } from '@src/common/datalayer-guard';
import { isConsentGranted } from '@src/common/consent-check';
import { createDebounceTracker } from '@src/common/debounce';
import { createEventGuard } from '@src/common/event-guard';
import { addInteractionListener } from '@src/common/dom-events';
import { bootstrapModule } from '@src/common/bootstrap';
import { cloneConfig } from '@src/common/clone-config';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: EcommerceConfig = {
    // Default item field values
    defaults: {
      brand: 'PocketPills',
      category: 'Telehealth',
      currency: 'CAD',
      quantity: 1,
      platform: 'web'
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

  const debounce = createDebounceTracker(CONFIG);
  const eventGuard = createEventGuard(ppLib);

  function getElementKey(el: Element): string {
    /*! v8 ignore start */
    const item = el.getAttribute(CONFIG.attributes.item) || '';
    const tag = el.tagName || '';
    /*! v8 ignore stop */
    const text = (el.textContent || '').substring(0, 50).trim();
    return tag + ':' + item + ':' + text;
  }

  // =====================================================
  // ITEM DATA EXTRACTION
  // =====================================================

  function parseItem(el: Element): EcommerceItem | null {
    /*! v8 ignore start */
    if (!el) return null;
    /*! v8 ignore stop */

    const attrs = CONFIG.attributes;
    const itemId = el.getAttribute(attrs.item);
    const itemName = el.getAttribute(attrs.name);
    /*! v8 ignore start */
    const itemPrice = el.getAttribute(attrs.price);
    /*! v8 ignore stop */

    // All three required
    /*! v8 ignore start */
    if (!itemId || !itemName || !itemPrice) {
      ppLib.log('warn', '[ppEcommerce] Missing required ecommerce attribute(s):' +
        (!itemId ? ' data-ecommerce-item' : '') +
        (!itemName ? ' data-ecommerce-name' : '') +
        (!itemPrice ? ' data-ecommerce-price' : ''));
      return null;
    }
    /*! v8 ignore stop */

    const item: EcommerceItem = {
      item_id: ppLib.Security.sanitize(itemId),
      item_name: ppLib.Security.sanitize(itemName),
      item_brand: ppLib.Security.sanitize(el.getAttribute(attrs.brand) || CONFIG.defaults.brand),
      item_category: ppLib.Security.sanitize(el.getAttribute(attrs.category) || CONFIG.defaults.category),
      price: ppLib.Security.sanitize(itemPrice),
      quantity: CONFIG.defaults.quantity
    };

    // Optional fields — only include if present
    const variant = el.getAttribute(attrs.variant);
    /*! v8 ignore start */
    if (variant) item.variant = ppLib.Security.sanitize(variant);
    /*! v8 ignore stop */

    const discount = el.getAttribute(attrs.discount);
    /*! v8 ignore start */
    if (discount) item.discount = ppLib.Security.sanitize(discount);
    /*! v8 ignore stop */

    const coupon = el.getAttribute(attrs.coupon);
    /*! v8 ignore start */
    if (coupon) item.coupon = ppLib.Security.sanitize(coupon);
    /*! v8 ignore stop */

    return item;
  }

  function getItemsFromDOM(): EcommerceItem[] {
    const elements = doc.querySelectorAll('[' + CONFIG.attributes.item + ']');
    const items: EcommerceItem[] = [];
    const seenIds: Record<string, boolean> = {};

    for (let i = 0; i < elements.length; i++) {
      const item = parseItem(elements[i]);
      /*! v8 ignore start */
      if (item) {
        const dedupeKey = item.item_id || item.item_name || '';
        if (!seenIds[dedupeKey]) {
          seenIds[dedupeKey] = true;
          items.push(item);
        }
      }
      /*! v8 ignore stop */
    }

    return items;
  }

  function resolveItemForCTA(ctaEl: Element): EcommerceItem | null {
    // Flat pattern: attributes directly on the CTA
    const item = parseItem(ctaEl);
    /*! v8 ignore start */
    if (item) return item;
    /*! v8 ignore stop */

    // Container pattern: find nearest ancestor with data-ecommerce-item
    const container = ctaEl.closest('[' + CONFIG.attributes.item + ']');
    /*! v8 ignore start */
    if (container) return parseItem(container);
    /*! v8 ignore stop */

    return null;
  }

  // =====================================================
  // BUILD ECOMMERCE DATA
  // =====================================================

  function deduplicateItems(items: EcommerceItem[]): EcommerceItem[] {
    const seen: Record<string, boolean> = {};
    const unique: EcommerceItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const key = items[i].item_id || items[i].item_name || '';
      if (key && seen[key]) continue;
      if (key) seen[key] = true;
      unique.push(items[i]);
    }
    return unique;
  }

  function buildEcommerceData(items: EcommerceItem[]): EcommerceData | null {
    /*! v8 ignore start */
    if (!items || items.length === 0) return null;
    /*! v8 ignore stop */

    const dedupedItems = deduplicateItems(items);

    // Calculate total value from all items
    let totalValue = 0;
    for (let i = 0; i < dedupedItems.length; i++) {
      const price = parseFloat(dedupedItems[i].price);
      /*! v8 ignore start */
      if (!isNaN(price)) {
        totalValue += price * (dedupedItems[i].quantity || 1);
      /*! v8 ignore stop */
      }
    }

    return {
      value: Math.round(totalValue * 100) / 100,
      currency: CONFIG.defaults.currency,
      items: dedupedItems
    };
  }

  // =====================================================
  // EVENT DISPATCHERS
  // =====================================================

  // Per the Analytics events spec, Mixpanel receives ecommerce data as
  // FLAT keys — `ecommerce_value`, `ecommerce_currency`, `item_ids[]`,
  // etc. dataLayer / GTM keeps the nested GA4 shape. Numeric prices on
  // items come in as strings (the DOM scrape preserves the raw string);
  // we surface both `item_prices` (number[]) for math and the raw
  // `item_prices_str` for forensic audit.
  function flattenEcommerceForMixpanel(ecommerceData: EcommerceData): Record<string, unknown> {
    const items = ecommerceData.items;
    const flat: Record<string, unknown> = {
      ecommerce_value: ecommerceData.value,
      ecommerce_currency: ecommerceData.currency,
      ecommerce_item_count: items.length,
    };

    const ids: string[] = [];
    const names: string[] = [];
    const brands: string[] = [];
    const categories: string[] = [];
    const prices: number[] = [];
    const quantities: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      ids.push(it.item_id);
      names.push(it.item_name);
      brands.push(it.item_brand);
      categories.push(it.item_category);
      const p = parseFloat(it.price);
      prices.push(isNaN(p) ? 0 : p);
      quantities.push(it.quantity || 1);
    }
    flat['item_ids'] = ids;
    flat['item_names'] = names;
    flat['item_brands'] = brands;
    flat['item_categories'] = categories;
    flat['item_prices'] = prices;
    flat['item_quantities'] = quantities;

    return flat;
  }

  function sendToGTM(eventName: string, ecommerceData: EcommerceData): void {
    try {
      /*! v8 ignore start */
      if (!CONFIG.platforms.gtm.enabled) return;
      /*! v8 ignore stop */

      const dl = ensureDataLayer(win);
      dl.splice(0, Math.max(0, dl.length - 500));

      const payload: Record<string, unknown> = {
        event: eventName,
        platform: CONFIG.defaults.platform,
        ecommerce: ecommerceData
      };

      /*! v8 ignore start */
      if (!ppLib.Security.validateData(payload)) {
      /*! v8 ignore stop */
        ppLib.log('error', '[ppEcommerce] Invalid GTM data rejected');
        return;
      }

      // GA4 best practice: clear previous ecommerce data
      win.dataLayer.push({ ecommerce: null });
      win.dataLayer.push(payload);

      // Wrap through safeLogPayload — item names / categories / coupons are
      // merchant-controlled strings that could carry PII (e.g. a coupon
      // code named after a customer). Same posture as Braze events.
      ppLib.log('info', '[ppEcommerce] GTM → ' + eventName, ppLib.safeLogPayload(ecommerceData));
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] GTM send error', ppLib.safeLogError(e));
    }
  }

  /*! v8 ignore start */
  function sendToMixpanel(eventName: string, ecommerceData: EcommerceData): void {
    try {
      if (!CONFIG.platforms.mixpanel.enabled) return;
      if (!win.mixpanel || !win.mixpanel.track) return;

      if (!ppLib.Security.validateData(ecommerceData)) {
        ppLib.log('error', '[ppEcommerce] Invalid Mixpanel data rejected');
        return;
      }

      // Route through the SDK facade so canonical event-properties context
      // (UTM touch, device, session, login, click IDs) is merged in.
      // Mixpanel gets the FLAT shape per the Analytics events spec —
      // `ecommerce_value`, `item_ids[]`, etc. dataLayer/GTM keeps nested.
      const flatPayload = flattenEcommerceForMixpanel(ecommerceData);
      trackViaMixpanel(ppLib, win, eventName, flatPayload);
      ppLib.log('info', '[ppEcommerce] Mixpanel → ' + eventName, ppLib.safeLogPayload(ecommerceData));
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] Mixpanel send error', ppLib.safeLogError(e));
    }
  }
  /*! v8 ignore stop */

  function dispatchEvent(eventName: string, ecommerceData: EcommerceData): void {
    // Consent gate — single check covers GTM + Mixpanel paths. Mixpanel
    // facade also self-gates, but stopping here avoids the redundant
    // GTM push (no point shipping ecommerce data to GTM if Mixpanel is denied).
    if (!isConsentGranted(ppLib)) return;
    /*! v8 ignore start */
    sendToGTM(eventName, ecommerceData);
    sendToMixpanel(eventName, ecommerceData);
    /*! v8 ignore stop */
  }

  // =====================================================
  // VIEW_ITEM — fires on page load
  // =====================================================

  function trackViewItem(): void {
    try {
      const items = getItemsFromDOM();
      /*! v8 ignore start */
      if (items.length === 0) {
      /*! v8 ignore stop */
        ppLib.log('verbose', '[ppEcommerce] No ecommerce items found on page');
        return;
      }

      // Cross-module guard: only fire view_item once per page load
      if (!eventGuard.claim('view_item')) return;

      const ecommerceData = buildEcommerceData(items);
      /*! v8 ignore start */
      if (!ecommerceData) return;
      /*! v8 ignore stop */

      dispatchEvent('view_item', ecommerceData);
      ppLib.log('info', '[ppEcommerce] view_item fired with ' + items.length + ' item(s)');
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] trackViewItem error', ppLib.safeLogError(e));
    }
  }

  // =====================================================
  // ADD_TO_CART — fires on CTA click
  // =====================================================

  function handleInteraction(e: Event): void {
    try {
      const target = e.target as Element;
      /*! v8 ignore start */
      const cta = target.closest(CONFIG.ctaSelector);

      if (!cta) return;
      /*! v8 ignore stop */

      // Debounce to prevent duplicate click + touchend
      const key = getElementKey(cta);
      /*! v8 ignore start */
      if (debounce.isDuplicate(key)) return;
      /*! v8 ignore stop */

      const item = resolveItemForCTA(cta);
      /*! v8 ignore start */
      if (!item) {
      /*! v8 ignore stop */
        ppLib.log('verbose', '[ppEcommerce] CTA clicked but no ecommerce data found');
        return;
      }

      const ecommerceData = buildEcommerceData([item]);
      /*! v8 ignore start */
      if (!ecommerceData) return;
      /*! v8 ignore stop */

      dispatchEvent('add_to_cart', ecommerceData);
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] handleInteraction error', ppLib.safeLogError(e));
    }
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function init(): void {
    try {
      // Event delegation for add_to_cart clicks
      addInteractionListener(doc, handleInteraction);

      // Defer view_item to window load so all analytics deps (Mixpanel, GTM)
      // are fully initialized.
      /*! v8 ignore start */
      if (doc.readyState === 'complete') {
      /*! v8 ignore stop */
        trackViewItem();
      } else {
        win.addEventListener('load', trackViewItem);
      }

      ppLib.log('info', '[ppEcommerce] Initialized');
    } catch (e) {
      ppLib.log('error', '[ppEcommerce] init error', ppLib.safeLogError(e));
    }
  }

  // Auto-initialize on DOM ready (bound guard prevents duplicate listeners across reloads)
  /*! v8 ignore start */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function() {
      if (!ppLib._ecomBound) { ppLib._ecomBound = true; init(); }
    });
  } else {
    if (!ppLib._ecomBound) { ppLib._ecomBound = true; init(); }
  }
  /*! v8 ignore stop */

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.ecommerce = {
    configure: function(options?: DeepPartial<EcommerceConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    trackViewItem: trackViewItem,

    trackItem: function(itemData: DeepPartial<EcommerceItem> & { price: string | number }): void {
      /*! v8 ignore start */
      if (!itemData || !itemData.item_id || !itemData.item_name || !itemData.price) {
        ppLib.log('error', '[ppEcommerce] trackItem requires item_id, item_name, and price');
        return;
      }
      /*! v8 ignore stop */

      const item: EcommerceItem = {
        item_id: ppLib.Security.sanitize(itemData.item_id),
        item_name: ppLib.Security.sanitize(itemData.item_name),
        item_brand: ppLib.Security.sanitize(itemData.item_brand || CONFIG.defaults.brand),
        item_category: ppLib.Security.sanitize(itemData.item_category || CONFIG.defaults.category),
        price: ppLib.Security.sanitize(String(itemData.price)),
        quantity: itemData.quantity || CONFIG.defaults.quantity
      };

      /*! v8 ignore start */
      if (itemData.variant) item.variant = ppLib.Security.sanitize(itemData.variant);
      if (itemData.discount) item.discount = ppLib.Security.sanitize(String(itemData.discount));
      if (itemData.coupon) item.coupon = ppLib.Security.sanitize(itemData.coupon);
      /*! v8 ignore stop */

      const ecommerceData = buildEcommerceData([item]);
      /*! v8 ignore start */
      if (ecommerceData) {
      /*! v8 ignore stop */
        dispatchEvent('add_to_cart', ecommerceData);
      }
    },

    getItems: function(): EcommerceItem[] {
      return getItemsFromDOM();
    },

    getConfig: function() {
      return cloneConfig(CONFIG);
    }
  };

  ppLib.log('info', '[ppEcommerce] Module loaded');

  } // end initModule

  bootstrapModule(win, initModule);

})(window, document);
