/**
 * pp-analytics-lib: Voucherify Module
 * Readonly pricing integration — qualifications, validation, DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.voucherify
 */
import type { PPLib } from '@src/types/common.types';
import type { VoucherifyConfig, ValidationContext, QualificationContext, PricingResult, ValidationResult, QualificationResult, OrderItem, DOMProduct, OffersResult, OffersBundle, OfferEntry, OfferCategory, FetchOffersOptions, VoucherifyRedeemable, VoucherifyApiResponse, EdgePricingResponse, CustomerMetadata } from '@src/types/voucherify.types';
import type { DeepPartial } from '@src/types/utility.types';
import { VoucherifyConfigError, VoucherifyApiError, VoucherifyPricingError } from '@src/voucherify/errors';
import { withRetryAsync } from '@src/common/retry';
import { createPriceFormatter, buildDiscountLabel as buildDiscountLabelHelper, type PriceFormatter } from '@src/voucherify/formatters';
import { createVoucherifyApiClient } from '@src/voucherify/api-client';
import {
  scanProductsFromDOM,
  removeCloakAttribute as removeCloakAttributeHelper,
  addLoadingClass as addLoadingClassHelper,
  removeLoadingClass as removeLoadingClassHelper,
} from '@src/voucherify/dom';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VoucherifyConfig = {
    api: {
      applicationId: '',
      clientPublicKey: '',
      clientSecretKey: '',
      // Voucherify regional endpoint. `as1.` (Asia-Singapore) is the
      // production region for Pocketpills' tenant — DO NOT change this to
      // the global `api.voucherify.io` or `us1.` / `eu1.` subdomains
      // without coordinating a tenant migration. Overridable per-deploy
      // via `ppLib.voucherify.configure({ api: { baseUrl: '...' } })`.
      baseUrl: 'https://as1.api.voucherify.io',
      origin: ''
    },
    cache: {
      enabled: false,
      baseUrl: '/api/voucherify',
      ttl: 300000
    },
    edge: {
      mode: 'direct',
      edgeUrl: ''
    },
    pricing: {
      autoFetch: true,
      productAttribute: 'data-voucherify-product',
      originalPriceAttribute: 'data-voucherify-original-price',
      discountedPriceAttribute: 'data-voucherify-discounted-price',
      discountLabelAttribute: 'data-voucherify-discount-label',
      priceAttribute: 'data-voucherify-base-price',
      currencySymbol: '$',
      currency: 'CAD',
      locale: 'en-CA'
    },
    offers: {
      autoFetch: false,
      containerAttribute: 'data-voucherify-offers',
      templateAttribute: 'data-voucherify-offer-template',
      offerTitleAttribute: 'data-voucherify-offer-title',
      offerDescriptionAttribute: 'data-voucherify-offer-description',
      offerCodeAttribute: 'data-voucherify-offer-code',
      offerDiscountAttribute: 'data-voucherify-offer-discount',
      offerCategoryAttribute: 'data-voucherify-offer-category',
      offerLoyaltyBalanceAttribute: 'data-voucherify-offer-loyalty-balance',
      offerGiftBalanceAttribute: 'data-voucherify-offer-gift-balance',
      emptyStateAttribute: 'data-voucherify-offers-empty',
      categories: ['coupon', 'promotion', 'loyalty', 'referral', 'gift'] as OfferCategory[],
      maxPerCategory: 10,
      personalizeForMember: false
    },
    context: {
      customerSourceIdCookie: 'userId',
      includeUtmParams: true,
      includeLoginState: true
    },
    consent: {
      required: false,
      mode: 'analytics',
      checkFunction: function() { return true; }
    },
    retry: {
      maxRetries: 2,
      baseDelay: 500,
      requestTimeoutMs: 8000
    },
    segments: {
      rules: [],
      cookieName: 'pp_segment',
      cookieMaxAgeMinutes: 30,
      prioritizeOverMember: false
    }
  };

  // =====================================================
  // API CLIENT (extracted to ./api-client.ts)
  // =====================================================

  const apiClient = createVoucherifyApiClient(win, ppLib, CONFIG);
  const apiQualifications = apiClient.apiQualifications;
  const apiValidations = apiClient.apiValidations;
  const apiRequest = apiClient.apiRequest;
  const fetchWithRetry = apiClient.fetchWithRetry;

  function clearCache(): void {
    apiClient.clearCache();
  }

  // =====================================================
  // REDEEMABLE EXTRACTION (shared across pricing + offers)
  // =====================================================

  /**
   * Extracts the redeemables array from a polymorphic Voucherify API response.
   * Handles 3 response shapes:
   *   1. { qualifications: [...] } (direct array)
   *   2. { redeemables: { data: [...] } } (nested with data)
   *   3. { qualifications: { data: [...] } } (nested qualifications)
   */
  function extractRedeemables(response: VoucherifyApiResponse): VoucherifyRedeemable[] {
    const raw = (response && response.qualifications) || (response && response.redeemables) || [];
    if (Array.isArray(raw)) return raw as VoucherifyRedeemable[];
    return ((raw as { data: VoucherifyRedeemable[] }).data || []);
  }

  // =====================================================
  // CONTEXT BUILDER
  // =====================================================

  function buildCustomer(): { source_id: string; metadata?: CustomerMetadata } | undefined {
    const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (!sourceId) return undefined;

    const customer: { source_id: string; metadata?: CustomerMetadata } = { source_id: ppLib.Security.sanitize(sourceId) };
    const metadata: CustomerMetadata = {};

    if (CONFIG.context.includeLoginState) {
      metadata.is_logged_in = !!(ppLib.login && ppLib.login.isLoggedIn());
    }

    if (CONFIG.context.includeUtmParams) {
      const url = win.location.href;
      const utmParams = ['utm_source', 'utm_medium', 'utm_campaign'];
      for (let i = 0; i < utmParams.length; i++) {
        const val = ppLib.getQueryParam(url, utmParams[i]);
        if (val) metadata[utmParams[i]] = ppLib.Security.sanitize(val);
      }
    }

    // Include rule-resolved segment key in customer metadata
    const ruleSegment = resolveSegmentFromRules();
    if (ruleSegment) {
      metadata.pp_segment = ruleSegment;

      // If the segment is an ad_source segment, also set ad_source metadata
      // so Voucherify validation rules can match on it
      if (ruleSegment.indexOf('ad_source:') === 0) {
        metadata.ad_source = ruleSegment.slice('ad_source:'.length);
      }
    }

    customer.metadata = metadata;
    return customer;
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

  function getProductsFromDOM(): DOMProduct[] {
    return scanProductsFromDOM(doc, ppLib, CONFIG);
  }

  // =====================================================
  // PRICING ENGINE
  // =====================================================

  // Formatter is rebuilt on configure() when locale/currency change.
  // Stored as a let-binding so reconfigure can swap it.
  let formatter: PriceFormatter = createPriceFormatter(CONFIG.pricing);

  function formatPrice(amount: number): string {
    return formatter.format(amount);
  }

  function buildDiscountLabel(discountType: string, discountAmount: number, basePrice: number): string {
    return buildDiscountLabelHelper(discountType, discountAmount, basePrice, formatter, ppLib.log);
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

  // =====================================================
  // EDGE MODE
  // =====================================================

  // Ad platform click ID → ad_source segment mapping.
  // These are standardized URL parameters set by ad platforms — not configurable.
  const CLICK_ID_MAP: Array<{ param: string; segment: string; source: string }> = [
    { param: 'gclid',    segment: 'ad_source:google',    source: 'google' },
    { param: 'fbclid',   segment: 'ad_source:facebook',  source: 'facebook' },
    { param: 'ttclid',   segment: 'ad_source:tiktok',    source: 'tiktok' },
    { param: 'msclkid',  segment: 'ad_source:bing',      source: 'bing' },
    { param: 'li_fat_id', segment: 'ad_source:linkedin', source: 'linkedin' },
    { param: 'epik',     segment: 'ad_source:pinterest',  source: 'pinterest' },
  ];

  function detectAdSourceFromClickId(params: URLSearchParams): string | null {
    // Check for platform click IDs (gclid, fbclid, ttclid, etc.)
    for (let i = 0; i < CLICK_ID_MAP.length; i++) {
      if (params.has(CLICK_ID_MAP[i].param)) {
        // Special case: fbclid is shared by Facebook and Instagram.
        // Use utm_source to disambiguate when available.
        if (CLICK_ID_MAP[i].param === 'fbclid') {
          const utmSrc = (params.get('utm_source') || '').toLowerCase().trim();
          if (utmSrc === 'instagram') return 'ad_source:instagram';
        }
        return CLICK_ID_MAP[i].segment;
      }
    }

    // Check utm_source as fallback — maps to ad_source:{value} if it matches a known platform
    const utmSource = params.get('utm_source');
    if (utmSource) {
      const normalized = utmSource.toLowerCase().trim();
      for (let j = 0; j < CLICK_ID_MAP.length; j++) {
        if (CLICK_ID_MAP[j].source === normalized) {
          return CLICK_ID_MAP[j].segment;
        }
      }
      // Unknown utm_source — still create a segment for it
      if (normalized) {
        return 'ad_source:' + ppLib.Security.sanitize(normalized);
      }
    }

    return null;
  }

  function persistSegmentCookie(segment: string): void {
    const maxAge = CONFIG.segments.cookieMaxAgeMinutes * 60;
    doc.cookie = CONFIG.segments.cookieName + '=' + encodeURIComponent(segment) +
      ';path=/;max-age=' + maxAge + ';SameSite=Lax';
  }

  function resolveSegmentFromRules(): string | null {
    const search = win.location.search;
    const params = new URLSearchParams(search);

    // Priority 1: Explicit segment param (e.g., ?vseg=ad_source:google)
    const explicitSeg = params.get('vseg');
    if (explicitSeg) {
      const sanitized = ppLib.Security.sanitize(explicitSeg);
      if (sanitized) {
        persistSegmentCookie(sanitized);
        return sanitized;
      }
    }

    // Priority 2: Configurable rules (param + value → segment)
    const rules = CONFIG.segments.rules;
    if (rules && rules.length > 0) {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        const paramValue = params.get(rule.param);
        if (paramValue === rule.value) {
          persistSegmentCookie(rule.segment);
          return rule.segment;
        }
      }
    }

    // Priority 3: Ad platform click IDs (gclid, fbclid, ttclid, etc.)
    const adSegment = detectAdSourceFromClickId(params);
    if (adSegment) {
      persistSegmentCookie(adSegment);
      return adSegment;
    }

    // Priority 4: Persisted cookie from a prior visit
    // getCookie already decodes — sanitize for defense-in-depth (cookie can be tampered)
    const cookieVal = ppLib.getCookie(CONFIG.segments.cookieName);
    if (cookieVal) return ppLib.Security.sanitize(cookieVal);

    return null;
  }

  function determineSegment(): string {
    if (CONFIG.segments.prioritizeOverMember) {
      const ruleSegment = resolveSegmentFromRules();
      if (ruleSegment) return ruleSegment;
      const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
      if (sourceId) return 'member';
      return 'anonymous';
    }

    // Default: member takes priority over rule-resolved segment
    const sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (sourceId) return 'member';
    const ruleSegment = resolveSegmentFromRules();
    if (ruleSegment) return ruleSegment;
    return 'anonymous';
  }

  function removeCloakAttribute(): void {
    removeCloakAttributeHelper(doc);
  }

  function addLoadingClass(products: DOMProduct[]): void {
    addLoadingClassHelper(products);
  }

  function removeLoadingClass(products: DOMProduct[]): void {
    removeLoadingClassHelper(products);
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

  async function edgeValidateVoucher(code: string, body: Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const response = await win.fetch(CONFIG.edge.edgeUrl + '/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new VoucherifyApiError('Edge validate non-OK', { endpoint: '/api/validate', status: response.status });
    return response.json() as Promise<VoucherifyApiResponse>;
  }

  async function edgeCheckQualifications(body: Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const response = await win.fetch(CONFIG.edge.edgeUrl + '/api/qualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new VoucherifyApiError('Edge qualify non-OK', { endpoint: '/api/qualify', status: response.status });
    return response.json() as Promise<VoucherifyApiResponse>;
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

  // =====================================================
  // OFFERS
  // =====================================================

  let inflightOffers: Promise<OffersResult> | null = null;

  const ALL_CATEGORIES: OfferCategory[] = ['coupon', 'promotion', 'loyalty', 'referral', 'gift'];

  function emptyBundle(): OffersBundle {
    return { coupons: [], promotions: [], loyalty: [], referrals: [], gifts: [] };
  }

  function emptyResult(segment: string): OffersResult {
    return { segment: segment, offers: emptyBundle(), timestamp: Date.now() };
  }

  async function fetchOffersEdge(segment: string): Promise<OffersBundle> {
    const url = CONFIG.edge.edgeUrl + '/api/offers/' + encodeURIComponent(segment);
    const response = await fetchWithRetry(url, { method: 'GET' });
    if (!response.ok) {
      throw new VoucherifyApiError('Edge offers API non-OK', { endpoint: '/api/offers', status: response.status });
    }
    const data = await response.json();
    return data.offers || emptyBundle();
  }

  function categorizeRedeemable(r: VoucherifyRedeemable): OfferCategory {
    if (r.object === 'promotion_tier' || r.object === 'promotion_stack') return 'promotion';
    if (r.object === 'loyalty_card') return 'loyalty';
    // Result-based detection (works for both "campaign" and "voucher" objects)
    if (r.result && r.result.loyalty_card) return 'loyalty';
    if (r.campaign_type === 'REFERRAL_PROGRAM') return 'referral';
    if (r.result && r.result.gift) return 'gift';
    // campaign objects with discount are auto-applied promotions
    if (r.object === 'campaign' && r.result && r.result.discount) return 'promotion';
    return 'coupon';
  }

  function buildOfferEntryFromRedeemable(r: VoucherifyRedeemable): OfferEntry {
    const category = categorizeRedeemable(r);
    const discount = r.result && r.result.discount;
    const entry: OfferEntry = {
      id: r.id,
      category: category,
      title: r.name || r.campaign_name || r.banner || r.campaign || '',
      description: '',
      applicableProductIds: []
    };

    if (r.voucher && r.voucher.code) entry.code = r.voucher.code;

    if (discount) {
      let discountLabel = '';
      if (discount.type === 'PERCENT' && discount.percent_off) {
        discountLabel = discount.percent_off + '% OFF';
        entry.description = 'Save ' + discount.percent_off + '% on your order';
      } else if (discount.type === 'AMOUNT' && discount.amount_off) {
        discountLabel = formatPrice(discount.amount_off / 100) + ' OFF';
        entry.description = 'Save ' + formatPrice(discount.amount_off / 100) + ' on your order';
      }
      entry.discount = {
        type: discount.type || 'NONE',
        percentOff: discount.percent_off,
        amountOff: discount.amount_off ? discount.amount_off / 100 : undefined,
        label: discountLabel
      };
    }

    if (r.result && r.result.loyalty_card) {
      entry.loyalty = {
        points: r.result.loyalty_card.points,
        balance: r.result.loyalty_card.balance
      };
      entry.description = r.result.loyalty_card.balance + ' points available';
    }

    if (r.result && r.result.gift) {
      entry.gift = {
        amount: r.result.gift.amount,
        balance: r.result.gift.balance
      };
      entry.description = formatPrice(r.result.gift.balance / 100) + ' gift card balance';
    }

    if (r.campaign_name || r.name) entry.campaignName = r.campaign_name || r.name;

    return entry;
  }

  function categorizeRedeemables(redeemables: VoucherifyRedeemable[]): OffersBundle {
    let bundle = emptyBundle();
    for (let i = 0; i < redeemables.length; i++) {
      const entry = buildOfferEntryFromRedeemable(redeemables[i]);
      switch (entry.category) {
        case 'coupon': bundle.coupons.push(entry); break;
        case 'promotion': bundle.promotions.push(entry); break;
        case 'loyalty': bundle.loyalty.push(entry); break;
        case 'referral': bundle.referrals.push(entry); break;
        case 'gift': bundle.gifts.push(entry); break;
      }
    }
    return bundle;
  }

  function mergeOffersBundles(base: OffersBundle, personal: OffersBundle): OffersBundle {
    const seenIds: Record<string, boolean> = {};
    const merged = emptyBundle();

    function addUnique(target: OfferEntry[], source: OfferEntry[]) {
      for (let i = 0; i < source.length; i++) {
        if (!seenIds[source[i].id]) {
          seenIds[source[i].id] = true;
          target.push(source[i]);
        }
      }
    }

    addUnique(merged.coupons, base.coupons);
    addUnique(merged.coupons, personal.coupons);
    addUnique(merged.promotions, base.promotions);
    addUnique(merged.promotions, personal.promotions);
    addUnique(merged.loyalty, base.loyalty);
    addUnique(merged.loyalty, personal.loyalty);
    addUnique(merged.referrals, base.referrals);
    addUnique(merged.referrals, personal.referrals);
    addUnique(merged.gifts, base.gifts);
    addUnique(merged.gifts, personal.gifts);

    return merged;
  }

  function filterBundle(bundle: OffersBundle, categories: OfferCategory[], maxPerCategory: number): OffersBundle {
    const filtered = emptyBundle();
    if (categories.indexOf('coupon') >= 0) filtered.coupons = bundle.coupons.slice(0, maxPerCategory);
    if (categories.indexOf('promotion') >= 0) filtered.promotions = bundle.promotions.slice(0, maxPerCategory);
    if (categories.indexOf('loyalty') >= 0) filtered.loyalty = bundle.loyalty.slice(0, maxPerCategory);
    if (categories.indexOf('referral') >= 0) filtered.referrals = bundle.referrals.slice(0, maxPerCategory);
    if (categories.indexOf('gift') >= 0) filtered.gifts = bundle.gifts.slice(0, maxPerCategory);
    return filtered;
  }

  function renderOffers(bundle: OffersBundle): void {
    const containerAttr = CONFIG.offers.containerAttribute;
    const containers = doc.querySelectorAll('[' + containerAttr + ']');

    for (let c = 0; c < containers.length; c++) {
      const container = containers[c];
      const categoryFilter = container.getAttribute(containerAttr) || 'all';
      const requestedCategories: OfferCategory[] = categoryFilter === 'all'
        ? ALL_CATEGORIES
        : categoryFilter.split(',').map(function(s) { return s.trim() as OfferCategory; });

      // Find template
      const template = container.querySelector('[' + CONFIG.offers.templateAttribute + ']') as HTMLElement | null;
      if (template) {
        template.style.display = 'none';
      }

      // Remove previous clones
      const oldClones = container.querySelectorAll('.pp-voucherify-offer-clone');
      for (let r = 0; r < oldClones.length; r++) {
        oldClones[r].parentNode!.removeChild(oldClones[r]);
      }

      // Collect matching offers
      let offers: OfferEntry[] = [];
      for (let k = 0; k < requestedCategories.length; k++) {
        const cat = requestedCategories[k];
        switch (cat) {
          case 'coupon': offers = offers.concat(bundle.coupons); break;
          case 'promotion': offers = offers.concat(bundle.promotions); break;
          case 'loyalty': offers = offers.concat(bundle.loyalty); break;
          case 'referral': offers = offers.concat(bundle.referrals); break;
          case 'gift': offers = offers.concat(bundle.gifts); break;
        }
      }

      // Clone template for each offer
      if (template) {
        for (let i = 0; i < offers.length; i++) {
          const offer = offers[i];
          const clone = template.cloneNode(true) as HTMLElement;
          clone.removeAttribute(CONFIG.offers.templateAttribute);
          clone.classList.add('pp-voucherify-offer-clone');
          clone.classList.add('pp-voucherify-offer-' + offer.category);
          clone.style.display = '';

          // Populate slots
          const titleEl = clone.querySelector('[' + CONFIG.offers.offerTitleAttribute + ']');
          if (titleEl) titleEl.textContent = offer.title;

          const descEl = clone.querySelector('[' + CONFIG.offers.offerDescriptionAttribute + ']');
          if (descEl) descEl.textContent = offer.description;

          const codeEl = clone.querySelector('[' + CONFIG.offers.offerCodeAttribute + ']') as HTMLElement | null;
          if (codeEl) {
            if (offer.code) {
              codeEl.textContent = offer.code;
              codeEl.style.display = '';
            } else {
              codeEl.style.display = 'none';
            }
          }

          const discountEl = clone.querySelector('[' + CONFIG.offers.offerDiscountAttribute + ']');
          if (discountEl) discountEl.textContent = (offer.discount && offer.discount.label) || '';

          const categoryEl = clone.querySelector('[' + CONFIG.offers.offerCategoryAttribute + ']');
          if (categoryEl) categoryEl.textContent = offer.category;

          const loyaltyEl = clone.querySelector('[' + CONFIG.offers.offerLoyaltyBalanceAttribute + ']');
          if (loyaltyEl) loyaltyEl.textContent = offer.loyalty ? String(offer.loyalty.balance) + ' pts' : '';

          const giftEl = clone.querySelector('[' + CONFIG.offers.offerGiftBalanceAttribute + ']');
          if (giftEl) giftEl.textContent = offer.gift ? formatPrice(offer.gift.balance / 100) : '';

          container.appendChild(clone);
        }
      }

      // Toggle empty state
      const emptyEl = container.querySelector('[' + CONFIG.offers.emptyStateAttribute + ']') as HTMLElement | null;
      if (emptyEl) {
        emptyEl.style.display = offers.length === 0 ? '' : 'none';
      }
    }
  }

  function addOffersLoadingClass(): void {
    const containers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']');
    for (let i = 0; i < containers.length; i++) {
      containers[i].classList.add('pp-voucherify-offers-loading');
    }
  }

  function removeOffersLoadingClass(): void {
    const containers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']');
    for (let i = 0; i < containers.length; i++) {
      containers[i].classList.remove('pp-voucherify-offers-loading');
    }
  }

  async function fetchOffersImpl(options?: FetchOffersOptions): Promise<OffersResult> {
    try {
      const segment = determineSegment();
      const categories = (options && options.categories != null) ? options.categories : CONFIG.offers.categories;
      const maxPerCategory = (options && options.maxPerCategory != null) ? options.maxPerCategory : CONFIG.offers.maxPerCategory;
      const personalize = (options && options.personalize != null) ? options.personalize : CONFIG.offers.personalizeForMember;

      // CMS mode: anonymous → return empty (offers from CMS already in HTML if needed)
      if (CONFIG.edge.mode === 'cms') {
        if (segment === 'anonymous') {
          return emptyResult(segment);
        }
        // Member: check page opt-in
        const memberOptIn = doc.querySelector('[data-voucherify-member-offers]');
        if (!memberOptIn) {
          return emptyResult(segment);
        }
      }

      addOffersLoadingClass();

      let bundle: OffersBundle;
      try {
        if (CONFIG.edge.mode === 'edge' || CONFIG.edge.mode === 'cms') {
          bundle = await fetchOffersEdge(segment);
        } else {
          // direct mode
          const customer = buildCustomer();
          const offerBody: Record<string, unknown> = { scenario: 'ALL' };
          if (customer) offerBody.customer = customer;
          const response = await apiQualifications(offerBody);
          bundle = categorizeRedeemables(extractRedeemables(response as VoucherifyApiResponse));
        }

        // Personal wallet merge
        if (personalize && segment === 'member') {
          const walletCustomer = buildCustomer();
          if (walletCustomer) {
            const walletBody: Record<string, unknown> = { scenario: 'CUSTOMER_WALLET', customer: walletCustomer };
            const walletResponse = await apiQualifications(walletBody);
            const personalBundle = categorizeRedeemables(extractRedeemables(walletResponse as VoucherifyApiResponse));
            bundle = mergeOffersBundles(bundle, personalBundle);
          }
        }

        const filtered = filterBundle(bundle, categories, maxPerCategory);

        // Auto-render if containers exist
        const hasContainers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']').length > 0;
        if (hasContainers) {
          renderOffers(filtered);
        }

        ppLib.log('info', '[ppVoucherify] Offers fetched for segment: ' + segment);

        return { segment: segment, offers: filtered, timestamp: Date.now() };
      } catch (e) {
        ppLib.log('warn', '[ppVoucherify] fetchOffers error', e);
        return emptyResult(segment);
      } finally {
        removeOffersLoadingClass();
      }
    } catch (e) {
      ppLib.log('error', '[ppVoucherify] fetchOffers error', ppLib.safeLogError(e));
      return emptyResult('unknown');
    }
  }

  async function fetchOffers(options?: FetchOffersOptions): Promise<OffersResult> {
    if (inflightOffers) return inflightOffers;
    inflightOffers = fetchOffersImpl(options);
    try { return await inflightOffers; } finally { inflightOffers = null; }
  }

  // =====================================================
  // CONSENT CHECK
  // =====================================================

  function hasConsent(): boolean {
    if (!CONFIG.consent.required) return true;

    if (CONFIG.consent.mode === 'analytics') {
      try {
        if (win.ppAnalytics && typeof win.ppAnalytics.consent === 'object' &&
            typeof win.ppAnalytics.consent.status === 'function') {
          return win.ppAnalytics.consent.status();
        }
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] consent check error', ppLib.safeLogError(e));
      }
      return false;
    }

    // custom mode
    return CONFIG.consent.checkFunction();
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  let initialized = false;

  function init(): void {
    if (initialized) return;

    if (!CONFIG.api.applicationId && !CONFIG.cache.enabled && CONFIG.edge.mode !== 'edge' && CONFIG.edge.mode !== 'cms') {
      ppLib.log('warn', '[ppVoucherify] No applicationId configured and cache not enabled. Call ppLib.voucherify.configure() before init.');
      return;
    }

    if (CONFIG.cache.enabled && !CONFIG.cache.baseUrl) {
      ppLib.log('warn', '[ppVoucherify] Cache enabled but cache.baseUrl is empty. Provide a cache proxy URL.');
      return;
    }

    // Consent gate
    if (!hasConsent()) {
      ppLib.log('info', '[ppVoucherify] Consent not granted — module not initialized');
      return;
    }

    // Hard-block credential exposure in any browser-direct mode. The
    // previous warn-only check was conditional on `edge.mode === 'direct'`,
    // which let undefined/empty/'cms' values bypass it. The condition below
    // fires whenever the secret would actually reach Voucherify from the
    // browser — i.e. when there is no cache proxy AND the edge worker is
    // not the consumer.
    const willExposeSecretInBrowser =
      !CONFIG.cache.enabled && CONFIG.edge.mode !== 'edge' && !!CONFIG.api.clientSecretKey;
    if (willExposeSecretInBrowser) {
      ppLib.log(
        'error',
        '[ppVoucherify] BLOCKED init: clientSecretKey is set in browser-direct mode and would leak Voucherify credentials. Set cache.enabled=true with a server proxy, or edge.mode="edge". To use the direct API in the browser, remove clientSecretKey and configure clientPublicKey only.'
      );
      return;
    }

    /*! v8 ignore start — jsdom readyState is always 'complete' */
    if (CONFIG.pricing.autoFetch) {
      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', function() {
          fetchPricing();
        });
      } else {
      /*! v8 ignore stop */
        fetchPricing();
      }
    }

    if (CONFIG.offers.autoFetch) {
      fetchOffers();
    }

    initialized = true;
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.voucherify = {
    configure: function(options?: DeepPartial<VoucherifyConfig>) {
      if (options) {
        ppLib.extend(CONFIG, options);
        // Rebuild formatter on locale/currency change so subsequent
        // formatPrice() calls reflect the new config.
        formatter = createPriceFormatter(CONFIG.pricing);
      }
      return CONFIG;
    },

    init: init,

    fetchPricing: function(productIds?: string[]): Promise<PricingResult[]> {
      return fetchPricing(productIds);
    },

    fetchOffers: function(options?: FetchOffersOptions): Promise<OffersResult> {
      return fetchOffers(options);
    },

    validateVoucher: function(code: string, context?: DeepPartial<ValidationContext>): Promise<ValidationResult> {
      try {
        const sanitizedCode = ppLib.Security.sanitize(code);
        if (!sanitizedCode) {
          return Promise.resolve({ valid: false, code: code, reason: 'Empty voucher code' });
        }

        const body: Record<string, unknown> = {
          redeemables: [{ object: 'voucher', id: sanitizedCode }]
        };

        if (context && context.customer) {
          body.customer = context.customer;
        }
        if (context && context.order) {
          body.order = context.order;
        }

        let validateFn: (b: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
        if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
          validateFn = function(b: Record<string, unknown>) {
            return edgeValidateVoucher(sanitizedCode, b).catch(function() {
              ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
              return apiValidations(b);
            });
          };
        } else {
          validateFn = apiValidations;
        }

        return validateFn(body).then(function(response: VoucherifyApiResponse) {
          const redeemables = extractRedeemables(response);
          const redeemable = redeemables[0];
          const result = redeemable && redeemable.result;

          return {
            valid: !!(redeemable && redeemable.status === 'APPLICABLE'),
            code: sanitizedCode,
            discount: result && result.discount,
            reason: redeemable && redeemable.status !== 'APPLICABLE' ? (redeemable.status || 'Unknown') : undefined,
            order: result && result.order ? {
              amount: result.order.amount || 0,
              discount_amount: result.order.discount_amount || 0,
              total_amount: result.order.total_amount || 0
            } : undefined
          } as ValidationResult;
        }).catch(function(err: unknown) {
          // Catch async errors from validateFn (network, edge fallback, typed
          // errors from apiRequest). Without this .catch the rejection
          // propagated as an unhandled promise rejection — the previous
          // surrounding try/catch only caught synchronous failures.
          ppLib.log('error', '[ppVoucherify] validateVoucher failed', ppLib.safeLogError(err));
          return { valid: false, code: sanitizedCode, reason: 'Validation error' } as ValidationResult;
        });
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] validateVoucher error', ppLib.safeLogError(e));
        return Promise.resolve({ valid: false, code: code, reason: 'Validation error' });
      }
    },

    checkQualifications: function(context?: QualificationContext): Promise<QualificationResult> {
      const body = context || { scenario: 'ALL' };

      let qualifyFn: (b: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
      if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
        qualifyFn = function(b: Record<string, unknown>) {
          return edgeCheckQualifications(b).catch(function() {
            ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
            return apiQualifications(b);
          });
        };
      } else {
        qualifyFn = apiQualifications;
      }

      return qualifyFn(body as Record<string, unknown>).then(function(response: VoucherifyApiResponse) {
        return {
          redeemables: response.redeemables || [],
          total: response.total || 0,
          hasMore: response.has_more || false
        } as QualificationResult;
      }).catch(function(err: unknown) {
        // Defensive: callers expect a fulfilled Promise<QualificationResult>;
        // emit an empty-but-shaped result rather than an unhandled rejection.
        ppLib.log('error', '[ppVoucherify] checkQualifications failed', ppLib.safeLogError(err));
        return { redeemables: [], total: 0, hasMore: false } as QualificationResult;
      });
    },

    clearCache: function() {
      clearCache();
    },

    isReady: function() {
      return initialized;
    },

    getConfig: function() {
      return JSON.parse(JSON.stringify(CONFIG));
    },

    getSegment: function() {
      return determineSegment();
    }
  };

  ppLib.log('info', '[ppVoucherify] Module loaded');

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
