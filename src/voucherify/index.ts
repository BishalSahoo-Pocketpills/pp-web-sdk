/**
 * pp-analytics-lib: Voucherify Module
 * Readonly pricing integration — qualifications, validation, DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.voucherify
 */
import type { PPLib } from '@src/types/common.types';
import type { VoucherifyConfig, ValidationContext, QualificationContext, PricingResult, ValidationResult, QualificationResult, OrderItem, DOMProduct, OffersResult, OffersBundle, OfferEntry, OfferCategory, FetchOffersOptions, VoucherifyRedeemable, VoucherifyApiResponse, EdgePricingResponse, CustomerMetadata } from '@src/types/voucherify.types';
import { VoucherifyConfigError, VoucherifyApiError } from '@src/voucherify/errors';

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
      baseDelay: 500
    },
    segments: {
      rules: [],
      cookieName: 'pp_segment',
      cookieMaxAgeMinutes: 30,
      prioritizeOverMember: false
    }
  };

  // =====================================================
  // API CLIENT
  // =====================================================

  const memCache: Map<string, { data: unknown; timestamp: number }> = new Map();

  function getCacheKey(endpoint: string, body: unknown): string {
    try {
      return endpoint + ':' + JSON.stringify(body);
    /*! v8 ignore start — JSON.stringify circular-ref throw is not reachable in normal usage */
    } catch (e) {
      return endpoint + ':' + String(Date.now());
    }
    /*! v8 ignore stop */
  }

  function isCacheValid(key: string): boolean {
    const entry = memCache.get(key);
    if (!entry) return false;
    if ((Date.now() - entry.timestamp) >= CONFIG.cache.ttl) {
      memCache.delete(key);
      return false;
    }
    return true;
  }

  async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    const maxRetries = CONFIG.retry.maxRetries;
    const baseDelay = CONFIG.retry.baseDelay;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await win.fetch(url, options);
        // Do not retry on 4xx client errors
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return response;
        }
        // 5xx — retry
        lastError = new Error('HTTP ' + response.status);
      } catch (e) {
        // Network error — retry
        lastError = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt < maxRetries) {
        await new Promise(function(resolve) {
          win.setTimeout(resolve, baseDelay * Math.pow(2, attempt));
        });
      }
    }
    throw lastError;
  }

  async function apiRequest(endpoint: string, body: QualificationContext | ValidationContext | Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const cacheKey = getCacheKey(endpoint, body);

    if (isCacheValid(cacheKey)) {
      ppLib.log('info', '[ppVoucherify] Cache hit for ' + endpoint);
      return memCache.get(cacheKey)!.data as VoucherifyApiResponse;
    }

    let apiResponse: Response;

    if (CONFIG.cache.enabled) {
      if (!CONFIG.cache.baseUrl) {
        throw new VoucherifyConfigError('cache.baseUrl is not configured', { endpoint });
      }
      apiResponse = await fetchWithRetry(CONFIG.cache.baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      if (!CONFIG.api.applicationId) {
        throw new VoucherifyConfigError('Voucherify API applicationId missing', { endpoint });
      }
      // Browser-direct mode requires a public client token. The init() guard
      // already refused to start the module if clientSecretKey is set without
      // a proxy/edge consumer, but we re-check here so direct invocations of
      // the public API after a misconfigured runtime override still fail safe.
      const browserToken = CONFIG.api.clientPublicKey;
      if (!browserToken) {
        if (CONFIG.api.clientSecretKey) {
          throw new VoucherifyConfigError(
            'clientSecretKey must not be sent from the browser; configure clientPublicKey, or use cache.enabled=true with a proxy, or edge.mode="edge".',
            { endpoint }
          );
        }
        throw new VoucherifyConfigError('Voucherify clientPublicKey missing', { endpoint });
      }
      /*! v8 ignore start — jsdom location.origin is always http://localhost */
      const origin = CONFIG.api.origin || win.location.origin;
      /*! v8 ignore stop */
      apiResponse = await fetchWithRetry(CONFIG.api.baseUrl + '/client/v1' + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Application-Id': CONFIG.api.applicationId,
          'X-Client-Token': browserToken,
          'origin': origin
        },
        body: JSON.stringify(body)
      });
    }

    if (!apiResponse.ok) {
      throw new VoucherifyApiError('Voucherify API non-OK', { endpoint, status: apiResponse.status });
    }

    const data = await apiResponse.json();

    memCache.set(cacheKey, { data: data, timestamp: Date.now() });

    // Evict stale entries when cache exceeds 50 entries to prevent unbounded growth
    if (memCache.size > 50) {
      const pruneTime = Date.now();
      memCache.forEach(function(entry, key) {
        if ((pruneTime - entry.timestamp) >= CONFIG.cache.ttl) {
          memCache.delete(key);
        }
      });
    }

    return data;
  }

  function apiQualifications(context: QualificationContext | Record<string, unknown>): Promise<VoucherifyApiResponse> {
    return apiRequest('/qualifications', context);
  }

  function apiValidations(context: ValidationContext | Record<string, unknown>): Promise<VoucherifyApiResponse> {
    return apiRequest('/validations', context);
  }

  function clearCache(): void {
    memCache.clear();
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
        ppLib.log('warn', '[ppVoucherify] Element with [' + attr + '] has empty product ID — skipped');
      }
    }

    return products;
  }

  // =====================================================
  // PRICING ENGINE
  // =====================================================

  let priceFormatter: Intl.NumberFormat | null = null;

  function getFormatter(): Intl.NumberFormat {
    if (!priceFormatter) {
      priceFormatter = new Intl.NumberFormat(CONFIG.pricing.locale, {
        style: 'currency',
        currency: CONFIG.pricing.currency
      });
    }
    return priceFormatter;
  }

  function formatPrice(amount: number): string {
    try {
      return getFormatter().format(amount);
    /*! v8 ignore start — Intl.NumberFormat.format() never throws in jsdom */
    } catch (e) {
      return CONFIG.pricing.currencySymbol + amount.toFixed(2);
    }
    /*! v8 ignore stop */
  }

  function buildDiscountLabel(discountType: string, discountAmount: number, basePrice: number): string {
    if (discountType === 'PERCENT') {
      const percent = Math.round((discountAmount / basePrice) * 100);
      return percent + '% OFF';
    }
    if (discountType === 'AMOUNT' || discountType === 'FIXED') {
      return formatPrice(discountAmount) + ' OFF';
    }
    ppLib.log('warn', '[ppVoucherify] Unknown discount type: ' + discountType);
    return '';
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
    doc.documentElement.removeAttribute('data-pp-segment-pending');
  }

  function addLoadingClass(products: DOMProduct[]): void {
    for (let i = 0; i < products.length; i++) {
      products[i].element.classList.add('pp-voucherify-loading');
    }
  }

  function removeLoadingClass(products: DOMProduct[]): void {
    for (let i = 0; i < products.length; i++) {
      products[i].element.classList.remove('pp-voucherify-loading');
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
      throw new Error('Edge API error: ' + response.status);
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
    if (!response.ok) throw new Error('Edge validate error: ' + response.status);
    return response.json() as Promise<VoucherifyApiResponse>;
  }

  async function edgeCheckQualifications(body: Record<string, unknown>): Promise<VoucherifyApiResponse> {
    const response = await win.fetch(CONFIG.edge.edgeUrl + '/api/qualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Edge qualify error: ' + response.status);
    return response.json() as Promise<VoucherifyApiResponse>;
  }

  let inflightPricing: Promise<PricingResult[]> | null = null;

  async function fetchPricingImpl(productIds?: string[]): Promise<PricingResult[]> {
    try {
      const products = getProductsFromDOM();
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
      ppLib.log('error', '[ppVoucherify] fetchPricing error', e);
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
      throw new Error('Edge offers API error: ' + response.status);
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
      ppLib.log('error', '[ppVoucherify] fetchOffers error', e);
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
        ppLib.log('error', '[ppVoucherify] consent check error', e);
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
    configure: function(options?: Partial<VoucherifyConfig>) {
      if (options) {
        ppLib.extend(CONFIG, options);
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

    validateVoucher: function(code: string, context?: Partial<ValidationContext>): Promise<ValidationResult> {
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
        });
      } catch (e) {
        ppLib.log('error', '[ppVoucherify] validateVoucher error', e);
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
