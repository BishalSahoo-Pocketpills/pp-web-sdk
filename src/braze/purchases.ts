import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';

export function createPurchaseHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  const PURCHASE_ATTR = 'data-braze-purchase';
  const PRICE_ATTR = 'data-braze-price';
  const CURRENCY_ATTR = 'data-braze-currency';
  const QUANTITY_ATTR = 'data-braze-quantity';

  const lastPurchaseMap: Record<string, number> = {};
  let debounceWriteCount = 0;
  let bound = false;
  let bridged = false;

  function isDuplicate(key: string): boolean {
    const now = Date.now();
    /*! v8 ignore start */
    // Prune stale entries every 100 writes to prevent unbounded growth
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (const k in lastPurchaseMap) {
        if ((now - lastPurchaseMap[k]) >= CONFIG.event.debounceMs) {
          delete lastPurchaseMap[k];
        }
      }
    }
    if (lastPurchaseMap[key] && (now - lastPurchaseMap[key]) < CONFIG.event.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastPurchaseMap[key] = now;
    return false;
  }

  function handlePurchaseClick(e: Event): void {
    try {
      const target = e.target as Element;
      const el = target.closest('[' + PURCHASE_ATTR + ']');

      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      const productId = el.getAttribute(PURCHASE_ATTR);
      const priceStr = el.getAttribute(PRICE_ATTR);

      /*! v8 ignore start */
      if (!productId || !priceStr) {
        ppLib.log('warn', '[ppBraze] Purchase element missing required attribute(s):' +
          (!productId ? ' data-braze-purchase' : '') +
          (!priceStr ? ' data-braze-price' : ''));
        return;
      }
      /*! v8 ignore stop */

      const sanitizedId = ppLib.Security.sanitize(productId);
      /*! v8 ignore start */
      if (!sanitizedId) return;
      /*! v8 ignore stop */

      const price = parseFloat(priceStr);
      /*! v8 ignore start */
      if (isNaN(price)) {
      /*! v8 ignore stop */
        ppLib.log('warn', '[ppBraze] Invalid price: ' + priceStr);
        return;
      }

      // Debounce
      const key = sanitizedId + ':' + price;
      /*! v8 ignore start */
      if (isDuplicate(key)) return;
      /*! v8 ignore stop */

      const currency = ppLib.Security.sanitize(el.getAttribute(CURRENCY_ATTR) || CONFIG.purchase.defaultCurrency);
      const quantityStr = el.getAttribute(QUANTITY_ATTR);
      let quantity = quantityStr ? parseInt(quantityStr, 10) : 1;
      /*! v8 ignore start */
      if (isNaN(quantity) || quantity < 1) quantity = 1;
      /*! v8 ignore stop */

      win.braze.logPurchase(sanitizedId, price, currency, quantity);
      ppLib.log('info', '[ppBraze] Purchase tracked → ' + sanitizedId, { price: price, currency: currency, quantity: quantity });
    } catch (err) {
      ppLib.log('error', '[ppBraze] handlePurchaseClick error', ppLib.safeLogError(err));
    }
  }

  function trackPurchase(
    productId: string,
    price: number,
    currency?: string,
    quantity?: number,
    properties?: Record<string, unknown>
  ): void {
    try {
      const sanitizedId = ppLib.Security.sanitize(productId);
      /*! v8 ignore start */
      if (!sanitizedId) {
        ppLib.log('warn', '[ppBraze] trackPurchase requires a non-empty productId');
        return;
      }
      /*! v8 ignore stop */

      /*! v8 ignore start */
      if (isNaN(price)) {
      /*! v8 ignore stop */
        ppLib.log('warn', '[ppBraze] trackPurchase invalid price: ' + price);
        return;
      }

      const cur = currency ? ppLib.Security.sanitize(currency) : CONFIG.purchase.defaultCurrency;
      const qty = (quantity && quantity >= 1) ? quantity : 1;

      // Sanitize properties if provided
      let sanitizedProps: Record<string, string> | undefined;
      /*! v8 ignore start */
      if (properties && typeof properties === 'object') {
      /*! v8 ignore stop */
        sanitizedProps = {};
        const keys = Object.keys(properties);
        for (let i = 0; i < keys.length; i++) {
          sanitizedProps[keys[i]] = ppLib.Security.sanitize(String(properties[keys[i]]));
        }
      }

      /*! v8 ignore start */
      if (sanitizedProps) {
      /*! v8 ignore stop */
        win.braze.logPurchase(sanitizedId, price, cur, qty, sanitizedProps);
      } else {
        win.braze.logPurchase(sanitizedId, price, cur, qty);
      }

      ppLib.log('info', '[ppBraze] trackPurchase → ' + sanitizedId, { price: price, currency: cur, quantity: qty });
    } catch (err) {
      ppLib.log('error', '[ppBraze] trackPurchase error', ppLib.safeLogError(err));
    }
  }

  function bridgeEcommerce(): void {
    if (!CONFIG.purchase.bridgeEcommerce) return;
    if (bridged) return;
    bridged = true;

    const originalPush = win.dataLayer && win.dataLayer.push;
    win.dataLayer = win.dataLayer || [];

    const origPush = Array.prototype.push;
    win.dataLayer.push = function(this: unknown[], ...pushArgs: unknown[]): number {
      const result = origPush.apply(win.dataLayer, pushArgs);

      for (let i = 0; i < pushArgs.length; i++) {
        const entry = pushArgs[i] as { event?: string; ecommerce?: { items?: Array<Record<string, string | number>>; currency?: string } } | undefined;
        /*! v8 ignore start */
        if (entry && entry.event === 'add_to_cart' && entry.ecommerce && entry.ecommerce.items) {
        /*! v8 ignore stop */
          const items = entry.ecommerce.items;
          for (let j = 0; j < items.length; j++) {
            const item = items[j];
            /*! v8 ignore start */
            if (item.item_id && item.price) {
            /*! v8 ignore stop */
              trackPurchase(
                String(item.item_id),
                parseFloat(String(item.price)),
                entry.ecommerce.currency || CONFIG.purchase.defaultCurrency,
                Number(item.quantity) || 1
              );
            }
          }
        }
      }

      return result;
    };

    ppLib.log('info', '[ppBraze] Ecommerce bridge active');
  }

  function bind(): void {
    if (bound) return;
    bound = true;

    doc.addEventListener('click', handlePurchaseClick, { capture: false, passive: true } as EventListenerOptions);
    doc.addEventListener('touchend', handlePurchaseClick, { capture: false, passive: true } as EventListenerOptions);

    bridgeEcommerce();

    ppLib.log('info', '[ppBraze] Purchase handler bound');
  }

  return {
    bind: bind,
    handlePurchaseClick: handlePurchaseClick,
    trackPurchase: trackPurchase,
    bridgeEcommerce: bridgeEcommerce
  };
}
