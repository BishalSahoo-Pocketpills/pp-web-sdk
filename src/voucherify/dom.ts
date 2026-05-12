/**
 * Voucherify DOM scanner + UI affordances.
 *
 * Two concerns extracted from `voucherify/index.ts`:
 *
 *   1. **`scanProductsFromDOM`** — find every `[data-voucherify-product]`
 *      element on the page, sanitize its product ID, parse its base
 *      price. Skips entries with empty / unsanitizable IDs and logs a
 *      warn so authors can audit the page.
 *
 *   2. **Loading / cloak helpers** — the SDK uses two DOM affordances
 *      while pricing fetches are in flight:
 *        * `<html data-pp-segment-pending>` — hides product cards via
 *          CSS until the first pricing render lands. Removed once
 *          rendering completes (or fails — baseline fallback still
 *          uncloaks so users aren't stuck on a blank page).
 *        * `.pp-voucherify-loading` on each product element — gives
 *          authors a hook to render a spinner per product.
 *
 * These are pure DOM utilities — no closure state, no network. Tested
 * in isolation makes regressions in the surrounding pricing engine
 * cheaper to diagnose.
 */

import type { PPLib } from '@src/types/common.types';
import type { VoucherifyConfig, DOMProduct } from '@src/types/voucherify.types';

const CLOAK_ATTRIBUTE = 'data-pp-segment-pending';
const LOADING_CLASS = 'pp-voucherify-loading';

export function scanProductsFromDOM(
  doc: Document,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig,
): DOMProduct[] {
  const attr = CONFIG.pricing.productAttribute;
  const priceAttr = CONFIG.pricing.priceAttribute;
  const elements = doc.querySelectorAll('[' + attr + ']');
  const products: DOMProduct[] = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const id = ppLib.Security.sanitize(el.getAttribute(attr) || '');
    const price = parseFloat(el.getAttribute(priceAttr) || '0');
    if (id) {
      products.push({ id: id, basePrice: price, element: el });
    } else {
      ppLib.log(
        'warn',
        '[ppVoucherify] Element with [' + attr + '] has empty product ID — skipped',
      );
    }
  }

  return products;
}

export function removeCloakAttribute(doc: Document): void {
  doc.documentElement.removeAttribute(CLOAK_ATTRIBUTE);
}

export function addLoadingClass(products: DOMProduct[]): void {
  for (let i = 0; i < products.length; i++) {
    products[i].element.classList.add(LOADING_CLASS);
  }
}

export function removeLoadingClass(products: DOMProduct[]): void {
  for (let i = 0; i < products.length; i++) {
    products[i].element.classList.remove(LOADING_CLASS);
  }
}
