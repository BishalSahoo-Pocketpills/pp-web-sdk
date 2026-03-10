import type { PPLib } from '../types/common.types';
import type { DataLayerConfig, DataLayerItemInput } from '../types/datalayer.types';

var ECOMMERCE_EVENTS: Record<string, boolean> = {
  view_item: true,
  add_to_cart: true,
  begin_checkout: true,
  add_payment_info: true,
  purchase: true
};

export function createDomBinder(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: DataLayerConfig,
  eventPusher: { pushEvent: (name: string, extra?: Record<string, any>) => void; pushEcommerceEvent: (name: string, items: DataLayerItemInput[], extra?: Record<string, any>) => void },
  itemBuilder: { normalizeItem: (input: DataLayerItemInput) => any; calculateValue: (items: any[]) => number }
) {

  var lastEventMap: Record<string, number> = {};
  var debounceWriteCount = 0;

  function isDuplicate(key: string): boolean {
    var now = Date.now();
    /*! v8 ignore start */
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (var k in lastEventMap) {
        if ((now - lastEventMap[k]) >= CONFIG.debounceMs) {
          delete lastEventMap[k];
        }
      }
    }
    if (lastEventMap[key] && (now - lastEventMap[key]) < CONFIG.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastEventMap[key] = now;
    return false;
  }

  function getElementId(el: Element): string {
    var id = el.id || el.getAttribute(CONFIG.attributes.event) || '';
    var tag = el.tagName || '';
    return tag + ':' + id;
  }

  function readAttr(el: Element, attr: string): string {
    return (el.getAttribute(attr) || '').trim();
  }

  function extractItemFromElement(el: Element): DataLayerItemInput {
    var item: DataLayerItemInput = {};

    var itemId = readAttr(el, CONFIG.attributes.itemId);
    var itemName = readAttr(el, CONFIG.attributes.itemName);
    var itemBrand = readAttr(el, CONFIG.attributes.itemBrand);
    var itemCategory = readAttr(el, CONFIG.attributes.itemCategory);
    var price = readAttr(el, CONFIG.attributes.price);
    var quantity = readAttr(el, CONFIG.attributes.quantity);
    var discount = readAttr(el, CONFIG.attributes.discount);
    var coupon = readAttr(el, CONFIG.attributes.coupon);

    if (itemId) item.item_id = itemId;
    if (itemName) item.item_name = itemName;
    if (itemBrand) item.item_brand = itemBrand;
    if (itemCategory) item.item_category = itemCategory;
    if (price) item.price = price;
    if (quantity) item.quantity = parseInt(quantity, 10) || 1;
    if (discount) item.discount = discount;
    if (coupon) item.coupon = coupon;

    return item;
  }

  function resolveItemElement(el: Element): Element {
    // Flat pattern: item attributes on the element itself
    if (el.hasAttribute(CONFIG.attributes.itemId) || el.hasAttribute(CONFIG.attributes.itemName)) {
      return el;
    }

    // Container pattern: find nearest ancestor with item data
    var container = el.closest('[' + CONFIG.attributes.itemId + '], [' + CONFIG.attributes.itemName + ']');
    return container || el;
  }

  function handleEcommerceEvent(eventName: string, el: Element): void {
    var itemEl = resolveItemElement(el);
    var itemInput = extractItemFromElement(itemEl);
    var extra: Record<string, any> = {};

    if (eventName === 'purchase') {
      var txnId = readAttr(el, CONFIG.attributes.transactionId);
      if (txnId) extra.transaction_id = txnId;
    }

    eventPusher.pushEcommerceEvent(eventName, [itemInput], extra);
  }

  function handleCoreEvent(eventName: string, el: Element): void {
    var data: Record<string, any> = {};

    var method = readAttr(el, CONFIG.attributes.method);
    var pageType = readAttr(el, CONFIG.attributes.pageType);
    var signupFlow = readAttr(el, CONFIG.attributes.signupFlow);
    var searchTerm = readAttr(el, CONFIG.attributes.searchTerm);
    var resultsCount = readAttr(el, CONFIG.attributes.resultsCount);
    var searchType = readAttr(el, CONFIG.attributes.searchType);

    if (method) data.method = method;
    if (pageType) data.page_type = pageType;
    if (signupFlow) data.signup_flow = signupFlow;
    if (searchTerm) data.search_term = searchTerm;
    if (resultsCount) data.results_count = parseInt(resultsCount, 10) || 0;
    if (searchType) data.search_type = searchType;

    if (eventName === 'pageview') {
      data.platform = CONFIG.defaults.platform;
    }

    eventPusher.pushEvent(eventName, data);
  }

  function handleInteraction(e: Event): void {
    try {
      var target = e.target as Element;
      /*! v8 ignore start */
      if (!target || !target.closest) return;
      /*! v8 ignore stop */

      var el = target.closest('[' + CONFIG.attributes.event + ']');
      if (!el) return;

      var elId = getElementId(el);
      /*! v8 ignore start */
      if (isDuplicate(elId)) return;
      /*! v8 ignore stop */

      var eventName = ppLib.Security.sanitize(readAttr(el, CONFIG.attributes.event));
      if (!eventName) return;

      // Anchor hitCallback: intercept navigation
      var isAnchor = el.tagName === 'A' && (el as HTMLAnchorElement).href;
      if (isAnchor) {
        e.preventDefault();
      }

      // Route to ecommerce or core handler
      if (ECOMMERCE_EVENTS[eventName]) {
        handleEcommerceEvent(eventName, el);
      } else {
        handleCoreEvent(eventName, el);
      }

      // Delayed navigation for anchors
      if (isAnchor) {
        var anchor = el as HTMLAnchorElement;
        var href = anchor.href;
        var anchorTarget = anchor.target;
        win.setTimeout(function() {
          try {
            if (anchorTarget === '_blank') {
              var popup = win.open(href, '_blank', 'noopener');
              if (!popup) {
                win.location.href = href;
              }
            } else {
              win.location.href = href;
            }
          } catch (navErr) {
            win.location.href = href;
          }
        }, CONFIG.navigationDelay);
      }
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] handleInteraction error', e);
    }
  }

  function init(): void {
    try {
      doc.addEventListener('click', handleInteraction, { capture: false, passive: false } as EventListenerOptions);
      doc.addEventListener('touchend', handleInteraction, { capture: false, passive: false } as EventListenerOptions);
      ppLib.log('info', '[ppDataLayer] DOM binding initialized');
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] init error', e);
    }
  }

  function scanViewItems(): void {
    try {
      var selector = '[' + CONFIG.attributes.viewItem + ']';
      var elements = doc.querySelectorAll(selector);
      if (elements.length === 0) {
        ppLib.log('verbose', '[ppDataLayer] No item elements found for auto view_item');
        return;
      }

      var items: DataLayerItemInput[] = [];
      for (var i = 0; i < elements.length; i++) {
        var item = extractItemFromElement(elements[i]);
        if (item.item_id || item.item_name) {
          items.push(item);
        }
      }

      if (items.length === 0) return;

      eventPusher.pushEcommerceEvent('view_item', items);
      ppLib.log('info', '[ppDataLayer] auto view_item fired with ' + items.length + ' item(s)');
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] scanViewItems error', e);
    }
  }

  return { init: init, bindDOM: init, handleInteraction: handleInteraction, scanViewItems: scanViewItems };
}
