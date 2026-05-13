/**
 * Voucherify pricing engine.
 *
 * Orchestrates the per-product price resolution pipeline:
 *   1. Scan DOM for product elements (delegated to dom.ts).
 *   2. Resolve the active segment (delegated to segment-resolver.ts).
 *   3. Fetch pricing — three transport branches:
 *        - Edge HTMLRewriter pre-resolved (skip client fetch).
 *        - `edge` / `cms` mode → JSON edge endpoint.
 *        - Direct mode → Voucherify qualifications API.
 *   4. Inject formatted prices into the DOM and remove the cloak attribute.
 *
 * Extracted from voucherify/index.ts so the renderer + transport branches
 * can be exercised independently. All closure state (CONFIG, ppLib,
 * formatter) is threaded as factory dependencies — no module-level
 * globals.
 */

import type { PPLib } from '@src/types/common.types';
import type {
  VoucherifyConfig,
  PricingResult,
  OrderItem,
  DOMProduct,
  VoucherifyRedeemable,
  VoucherifyApiResponse,
  EdgePricingResponse,
  CustomerMetadata,
} from '@src/types/voucherify.types';

type Customer = { source_id: string; metadata?: CustomerMetadata };
import { VoucherifyApiError, VoucherifyPricingError } from '@src/voucherify/errors';
import type { PriceFormatter } from '@src/voucherify/formatters';
import { buildDiscountLabel as buildDiscountLabelHelper } from '@src/voucherify/formatters';

export interface PricingEngineDeps {
  win: Window & typeof globalThis;
  doc: Document;
  ppLib: PPLib;
  CONFIG: VoucherifyConfig;
  /** Live formatter accessor — rebuilt by configure(), so resolve lazily. */
  getFormatter: () => PriceFormatter;
  apiQualifications: (body: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
  determineSegment: () => string;
  /** Shared with offers manager — supplied by index.ts. */
  buildCustomer: () => Customer | undefined;
  /** Shared with offers manager — supplied by index.ts. */
  extractRedeemables: (response: VoucherifyApiResponse) => VoucherifyRedeemable[];
  getProductsFromDOM: () => DOMProduct[];
  removeCloakAttribute: () => void;
  addLoadingClass: (products: DOMProduct[]) => void;
  removeLoadingClass: (products: DOMProduct[]) => void;
}

export interface PricingEngine {
  fetchPricing: (productIds?: string[]) => Promise<PricingResult[]>;
}

export function createPricingEngine(deps: PricingEngineDeps): PricingEngine {
  const {
    win,
    doc,
    ppLib,
    CONFIG,
    getFormatter,
    apiQualifications,
    determineSegment,
    buildCustomer,
    extractRedeemables,
    getProductsFromDOM,
    removeCloakAttribute,
    addLoadingClass,
    removeLoadingClass,
  } = deps;

  function formatPrice(amount: number): string {
    return getFormatter().format(amount);
  }

  function buildDiscountLabel(discountType: string, discountAmount: number, basePrice: number): string {
    return buildDiscountLabelHelper(discountType, discountAmount, basePrice, getFormatter(), ppLib.log);
  }

  function buildOrderItems(productIds: string[]): OrderItem[] {
    const items: OrderItem[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const sanitizedId = ppLib.Security.sanitize(productIds[i]);
      items.push({
        source_id: sanitizedId,
        product_id: sanitizedId,
        related_object: 'product',
        quantity: 1
      });
    }
    return items;
  }

  function mapQualificationsToResults(
    productIds: string[],
    products: DOMProduct[],
    response: VoucherifyApiResponse
  ): PricingResult[] {
    const results: PricingResult[] = [];
    const redeemables = extractRedeemables(response);

    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i];
      const domProduct = products.find(function(p) { return p.id === productId; });
      const basePrice = domProduct ? domProduct.basePrice : 0;
      let bestDiscount = 0;
      let bestType: PricingResult['discountType'] = 'NONE';
      const applicableVouchers: string[] = [];
      let campaignName: string | undefined;

      for (let j = 0; j < redeemables.length; j++) {
        const redeemable = redeemables[j];
        const discount = redeemable.result && redeemable.result.discount;
        if (!discount) continue;

        // UNIT discounts with ADD_MISSING_ITEMS add a free product (e.g. shipping),
        // they don't reduce the current product's price
        if (discount.type === 'UNIT' && discount.effect === 'ADD_MISSING_ITEMS') continue;

        let discountAmount = 0;
        let discountType: PricingResult['discountType'] = 'NONE';

        if (discount.type === 'PERCENT') {
          discountType = 'PERCENT';
          discountAmount = basePrice * ((discount.percent_off || 0) / 100);
        } else if (discount.type === 'AMOUNT') {
          discountType = 'AMOUNT';
          discountAmount = (discount.amount_off || 0) / 100; // cents to dollars
        } else if (discount.type === 'FIXED') {
          discountType = 'FIXED';
          discountAmount = basePrice - ((discount.fixed_amount || 0) / 100);
        } else if (discount.type === 'UNIT') {
          discountType = 'UNIT';
          discountAmount = (discount.unit_off || 0) * basePrice;
        }

        if (discountAmount > bestDiscount) {
          bestDiscount = discountAmount;
          bestType = discountType;
          campaignName = redeemable.campaign || redeemable.campaign_name;
        }

        if (redeemable.id) applicableVouchers.push(redeemable.id);
      }

      const discountedPrice = Math.max(0, basePrice - bestDiscount);
      let discountLabel = bestType !== 'NONE' ? buildDiscountLabel(bestType, bestDiscount, basePrice) : '';

      results.push({
        productId: productId,
        basePrice: basePrice,
        discountedPrice: discountedPrice,
        discountAmount: bestDiscount,
        discountLabel: discountLabel,
        discountType: bestType,
        applicableVouchers: applicableVouchers,
        campaignName: campaignName
      });
    }

    return results;
  }

  // Baseline fallback — used by the pricing pipeline's outer catch so that
  // network/edge failures still produce a renderable PricingResult per
  // product (basePrice == discountedPrice, no discount label). Without this
  // the renderer is never called, the cloak attribute stays on, and the
  // user sees an unstyled "loading" state until they reload.
  function buildBaselineResults(products: DOMProduct[]): PricingResult[] {
    const results: PricingResult[] = [];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      // Guard against NaN / negative `basePrice` from a malformed DOM
      // attribute. parseFloat in `getProductsFromDOM` returns NaN for
      // non-numeric strings; a negative price would render as a credit.
      const safePrice =
        typeof p.basePrice === 'number' && isFinite(p.basePrice) && p.basePrice >= 0
          ? p.basePrice
          : 0;
      results.push({
        productId: p.id,
        basePrice: safePrice,
        discountedPrice: safePrice,
        discountAmount: 0,
        discountLabel: '',
        discountType: 'NONE',
        applicableVouchers: [],
        campaignName: ''
      });
    }
    return results;
  }

  function injectPricing(products: DOMProduct[], pricingResults: PricingResult[]): void {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const result = pricingResults.find(function(r) { return r.productId === product.id; });
      if (!result) continue;

      const el = product.element;

      // Inject original price
      const originalEl = el.querySelector('[' + CONFIG.pricing.originalPriceAttribute + ']');
      if (originalEl) originalEl.textContent = formatPrice(product.basePrice);

      // Inject discounted price
      const discountedEl = el.querySelector('[' + CONFIG.pricing.discountedPriceAttribute + ']');
      if (discountedEl) {
        discountedEl.textContent = result.discountedPrice < product.basePrice
          ? formatPrice(result.discountedPrice)
          : formatPrice(product.basePrice);
      }

      // Inject discount label (optional)
      const labelEl = el.querySelector('[' + CONFIG.pricing.discountLabelAttribute + ']');
      if (labelEl) {
        labelEl.textContent = result.discountLabel || '';
      }
    }
  }

  async function fetchPricingEdge(products: DOMProduct[], ids: string[]): Promise<PricingResult[]> {
    const segment = determineSegment();
    const basePrices = ids.map(function(id) {
      const p = products.find(function(dp) { return dp.id === id; });
      return p ? p.basePrice : 0;
    });

    const url = CONFIG.edge.edgeUrl + '/api/prices/' + encodeURIComponent(segment) +
      '?products=' + encodeURIComponent(ids.join(',')) +
      '&basePrices=' + encodeURIComponent(basePrices.join(','));

    const response = await win.fetch(url);
    if (!response.ok) {
      throw new VoucherifyApiError('Edge pricing API non-OK', { endpoint: '/api/pricing', status: response.status });
    }

    const data = await response.json() as EdgePricingResponse;
    const pricingProducts = data.products || {};

    const results: PricingResult[] = [];
    for (let i = 0; i < ids.length; i++) {
      const entry = pricingProducts[ids[i]];
      if (entry) {
        results.push({
          productId: ids[i],
          basePrice: entry.basePrice,
          discountedPrice: entry.discountedPrice,
          discountAmount: entry.discountAmount,
          discountLabel: entry.discountLabel || '',
          discountType: entry.discountType || 'NONE',
          applicableVouchers: entry.applicableVouchers || [],
          campaignName: entry.campaignName
        });
      } else {
        const bp = basePrices[i];
        results.push({
          productId: ids[i],
          basePrice: bp,
          discountedPrice: bp,
          discountAmount: 0,
          discountLabel: '',
          discountType: 'NONE',
          applicableVouchers: []
        });
      }
    }
    return results;
  }

  let inflightPricing: Promise<PricingResult[]> | null = null;

  async function fetchPricingImpl(productIds?: string[]): Promise<PricingResult[]> {
    // Hoisted out of the try block so the catch can reuse the same DOM scan
    // for baseline rendering. `getProductsFromDOM` runs `querySelectorAll` on
    // a configurable attribute — non-trivial cost on large product pages —
    // and was previously called twice on every fetch failure.
    const products = getProductsFromDOM();
    try {
      const ids = productIds || products.map(function(p) { return p.id; });
      if (ids.length === 0) return [];

      // Edge rewrite guard: if the Worker already injected prices into the HTML
      // (Phase 2 edge HTMLRewriter), skip the client-side fetch entirely.
      // The attribute data-pp-segment-resolved is set by the edge rewrite Worker.
      const edgeResolved = doc.querySelector('[data-pp-segment-resolved]');
      if (edgeResolved) {
        const resolvedSegment = edgeResolved.getAttribute('data-pp-segment-resolved') || 'unknown';
        ppLib.log('info', '[ppVoucherify] Edge-rewritten pricing detected (segment: ' + resolvedSegment + ') — skipping client fetch');
        removeCloakAttribute();
        return [];
      }

      // CMS mode: anonymous users already have prices in HTML from CMS.
      // Rule-resolved segments always fetch from edge. Members use page opt-in.
      if (CONFIG.edge.mode === 'cms') {
        const segment = determineSegment();

        // Rule-resolved custom segment: always fetch from edge
        if (segment !== 'anonymous' && segment !== 'member') {
          addLoadingClass(products);
          try {
            const segEdgeResults = await fetchPricingEdge(products, ids);
            injectPricing(products, segEdgeResults);
            removeCloakAttribute();
            ppLib.log('info', '[ppVoucherify] CMS mode: segment "' + segment + '" pricing fetched for ' + ids.length + ' product(s)');
            return segEdgeResults;
          } catch (e) {
            ppLib.log('warn', '[ppVoucherify] Edge fetch failed in CMS mode for segment "' + segment + '", keeping CMS prices');
            removeCloakAttribute();
            return [];
          } finally {
            removeLoadingClass(products);
          }
        }

        if (segment === 'anonymous') {
          return [];
        }
        // Member: check page opt-in attribute
        const pageOptIn = doc.querySelector('[data-voucherify-member-pricing]');
        if (!pageOptIn) {
          return [];
        }
        // Member + opt-in: fetch from edge
        addLoadingClass(products);
        try {
          const cmsEdgeResults = await fetchPricingEdge(products, ids);
          injectPricing(products, cmsEdgeResults);
          ppLib.log('info', '[ppVoucherify] CMS mode: member pricing fetched for ' + ids.length + ' product(s)');
          return cmsEdgeResults;
        } catch (e) {
          ppLib.log('warn', '[ppVoucherify] Edge fetch failed in CMS mode, keeping CMS prices');
          return [];
        } finally {
          removeLoadingClass(products);
        }
      }

      if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
        addLoadingClass(products);
        try {
          const edgeResults = await fetchPricingEdge(products, ids);
          injectPricing(products, edgeResults);
          removeCloakAttribute();
          removeLoadingClass(products);
          ppLib.log('info', '[ppVoucherify] Edge pricing fetched for ' + ids.length + ' product(s)');
          return edgeResults;
        } catch (e) {
          ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
          removeLoadingClass(products);
          // Fall through to direct API
        }
      }

      const customer = buildCustomer();
      const items = buildOrderItems(ids);

      const body: Record<string, unknown> = {
        order: { items: items },
        scenario: 'ALL'
      };
      if (customer) body.customer = customer;

      const response = await apiQualifications(body);

      const results = mapQualificationsToResults(ids, products, response);

      injectPricing(products, results);
      removeCloakAttribute();

      ppLib.log('info', '[ppVoucherify] Pricing fetched for ' + ids.length + ' product(s)');

      return results;
    } catch (e) {
      // Pricing pipeline failed — emit a structured error log and fall back
      // to baseline pricing (basePrice as both retail and "discounted" so the
      // DOM renders something coherent). Previously this returned `[]` and
      // never invoked the renderer, leaving the page in a cloaked state.
      ppLib.log('error', '[ppVoucherify] fetchPricing error', ppLib.safeLogError(e));
      try {
        // Reuse the products from the outer scope — already scanned once.
        if (products.length > 0) {
          const baseline = buildBaselineResults(products);
          injectPricing(products, baseline);
          removeCloakAttribute();
          return baseline;
        }
      } catch (fallbackErr) {
        // Renderer / DOM mutation failed during baseline emission. Wrap as a
        // typed pricing error so the log carries `errorClass:
        // VoucherifyPricingError` instead of an opaque object.
        const wrapped = new VoucherifyPricingError('baseline-fallback render failed', {
          cause: (fallbackErr as { message?: string } | null)?.message
        });
        ppLib.log('error', '[ppVoucherify] ' + wrapped.message, ppLib.safeLogError(wrapped));
      }
      return [];
    }
  }

  async function fetchPricing(productIds?: string[]): Promise<PricingResult[]> {
    if (inflightPricing) return inflightPricing;
    inflightPricing = fetchPricingImpl(productIds);
    try { return await inflightPricing; } finally { inflightPricing = null; }
  }

  return {
    fetchPricing,
  };
}
