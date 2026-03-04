import type { PPLib } from '../types/common.types';
import type { VoucherifyConfig, OrderItem } from '../types/voucherify.types';

export interface DOMProduct {
  id: string;
  basePrice: number;
  element: Element;
}

export function createContextBuilder(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig
) {
  function buildCustomer(): { source_id: string; metadata?: Record<string, any> } | undefined {
    var sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (!sourceId) return undefined;

    var customer: any = { source_id: ppLib.Security.sanitize(sourceId) };
    var metadata: Record<string, any> = {};

    if (CONFIG.context.includeLoginState) {
      metadata.is_logged_in = !!(ppLib.login && ppLib.login.isLoggedIn());
    }

    if (CONFIG.context.includeUtmParams) {
      var url = win.location.href;
      var utmParams = ['utm_source', 'utm_medium', 'utm_campaign'];
      for (var i = 0; i < utmParams.length; i++) {
        var val = ppLib.getQueryParam(url, utmParams[i]);
        if (val) metadata[utmParams[i]] = ppLib.Security.sanitize(val);
      }
    }

    customer.metadata = metadata;
    return customer;
  }

  function buildOrderItems(productIds: string[]): OrderItem[] {
    var items: OrderItem[] = [];
    for (var i = 0; i < productIds.length; i++) {
      var sanitizedId = ppLib.Security.sanitize(productIds[i]);
      items.push({
        source_id: sanitizedId,
        product_id: sanitizedId,
        quantity: 1
      });
    }
    return items;
  }

  function getProductsFromDOM(): DOMProduct[] {
    var attr = CONFIG.pricing.productAttribute;
    var priceAttr = CONFIG.pricing.priceAttribute;
    var elements = doc.querySelectorAll('[' + attr + ']');
    var products: DOMProduct[] = [];

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var id = ppLib.Security.sanitize(el.getAttribute(attr) || '');
      var price = parseFloat(el.getAttribute(priceAttr) || '0');
      if (id) {
        products.push({ id: id, basePrice: price, element: el });
      } else {
        ppLib.log('warn', '[ppVoucherify] Element with [' + attr + '] has empty product ID — skipped');
      }
    }

    return products;
  }

  return {
    buildCustomer: buildCustomer,
    buildOrderItems: buildOrderItems,
    getProductsFromDOM: getProductsFromDOM
  };
}
