import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerItemInput, DataLayerItem } from '@src/types/datalayer.types';
import { createDebounceTracker } from '@src/common/debounce';
import { createEventGuard } from '@src/common/event-guard';

const ECOMMERCE_EVENTS: Record<string, boolean> = {
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
  eventPusher: { pushEvent: (name: string, extra?: Record<string, unknown>) => void; pushEcommerceEvent: (name: string, items: DataLayerItemInput[], extra?: Record<string, unknown>) => void },
  itemBuilder: { normalizeItem: (input: DataLayerItemInput) => DataLayerItem; calculateValue: (items: DataLayerItem[]) => string }
) {

  const debounce = createDebounceTracker(CONFIG);
  const eventGuard = createEventGuard(ppLib);
  let bound = false;

  function getElementId(el: Element): string {
    const id = el.id || el.getAttribute(CONFIG.attributes.event) || '';
    const tag = el.tagName || '';
    return tag + ':' + id;
  }

  function readAttr(el: Element, attr: string): string {
    return (el.getAttribute(attr) || '').trim();
  }

  function extractItemFromElement(el: Element): DataLayerItemInput {
    const item: DataLayerItemInput = {};

    const itemId = readAttr(el, CONFIG.attributes.itemId);
    const itemName = readAttr(el, CONFIG.attributes.itemName);
    const itemBrand = readAttr(el, CONFIG.attributes.itemBrand);
    const itemCategory = readAttr(el, CONFIG.attributes.itemCategory);
    const price = readAttr(el, CONFIG.attributes.price);
    const quantity = readAttr(el, CONFIG.attributes.quantity);
    const discount = readAttr(el, CONFIG.attributes.discount);
    const coupon = readAttr(el, CONFIG.attributes.coupon);

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
    const container = el.closest('[' + CONFIG.attributes.itemId + '], [' + CONFIG.attributes.itemName + ']');
    return container || el;
  }

  function handleEcommerceEvent(eventName: string, el: Element): void {
    const itemEl = resolveItemElement(el);
    const itemInput = extractItemFromElement(itemEl);
    const extra: Record<string, unknown> = {};

    if (eventName === 'purchase') {
      const txnId = readAttr(el, CONFIG.attributes.transactionId);
      if (txnId) extra.transaction_id = txnId;
    }

    eventPusher.pushEcommerceEvent(eventName, [itemInput], extra);
  }

  function handleCoreEvent(eventName: string, el: Element): void {
    const data: Record<string, unknown> = {};

    const method = readAttr(el, CONFIG.attributes.method);
    const pageType = readAttr(el, CONFIG.attributes.pageType);
    const signupFlow = readAttr(el, CONFIG.attributes.signupFlow);
    const searchTerm = readAttr(el, CONFIG.attributes.searchTerm);
    const resultsCount = readAttr(el, CONFIG.attributes.resultsCount);
    const searchType = readAttr(el, CONFIG.attributes.searchType);

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
      const target = e.target as Element;
        if (!target || !target.closest) return;
  
      const el = target.closest('[' + CONFIG.attributes.event + ']');
      if (!el) return;

      const elId = getElementId(el);
        if (debounce.isDuplicate(elId)) return;
  
      const eventName = ppLib.Security.sanitize(readAttr(el, CONFIG.attributes.event));
      if (!eventName) return;

      // Anchor hitCallback: intercept navigation
      const isAnchor = el.tagName === 'A' && (el as HTMLAnchorElement).href;
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
        const anchor = el as HTMLAnchorElement;
        const href = anchor.href;
        const anchorTarget = anchor.target;
        // Validate BEFORE scheduling — otherwise we closure-capture a tainted
        // href and a delayed off-site redirect still fires after the analytics
        // beacon. Event has already been pushed; just refuse to navigate.
        if (!ppLib.Security.isSafeRedirectUrl(href, CONFIG.allowedRedirectHosts)) {
          // Shape-only payload: never log the raw href because it may carry
          // session tokens or attacker-controlled fragments. Hostname alone
          // is enough to triage in dashboards.
          let hostHint = '';
          try { hostHint = new URL(href, win.location.href).hostname; } catch (_e) { /* ignore */ }
          ppLib.log('warn', '[ppDataLayer] blocked unsafe redirect', ppLib.safeLogPayload({ host: hostHint }));
          return;
        }
        win.setTimeout(function() {
          try {
            if (anchorTarget === '_blank') {
              const popup = win.open(href, '_blank', 'noopener');
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
      ppLib.log('error', '[ppDataLayer] handleInteraction error', ppLib.safeLogError(e));
    }
  }

  function init(): void {
    try {
      if (bound) return;
      bound = true;
      doc.addEventListener('click', handleInteraction, { capture: false, passive: false } as EventListenerOptions);
      doc.addEventListener('touchend', handleInteraction, { capture: false, passive: false } as EventListenerOptions);
      ppLib.log('info', '[ppDataLayer] DOM binding initialized');
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] init error', ppLib.safeLogError(e));
    }
  }

  function scanViewItems(): void {
    try {
      // Cross-module guard: skip if ecommerce module already fired view_item
      if (!eventGuard.claim('view_item')) {
        ppLib.log('verbose', '[ppDataLayer] view_item already fired by another module');
        return;
      }

      const selector = '[' + CONFIG.attributes.viewItem + ']';
      const elements = doc.querySelectorAll(selector);
      if (elements.length === 0) {
        ppLib.log('verbose', '[ppDataLayer] No item elements found for auto view_item');
        return;
      }

      const items: DataLayerItemInput[] = [];
      const seenIds: Record<string, boolean> = {};
      for (let i = 0; i < elements.length; i++) {
        const item = extractItemFromElement(elements[i]);
        if (item.item_id || item.item_name) {
          const dedupeKey = item.item_id || item.item_name || '';
          if (!seenIds[dedupeKey]) {
            seenIds[dedupeKey] = true;
            items.push(item);
          }
        }
      }

      if (items.length === 0) return;

      eventPusher.pushEcommerceEvent('view_item', items);
      ppLib.log('info', '[ppDataLayer] auto view_item fired with ' + items.length + ' item(s)');
    } catch (e) {
      ppLib.log('error', '[ppDataLayer] scanViewItems error', ppLib.safeLogError(e));
    }
  }

  return { init: init, bindDOM: init, handleInteraction: handleInteraction, scanViewItems: scanViewItems };
}
