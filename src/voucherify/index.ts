/**
 * pp-analytics-lib: Voucherify Module
 * Readonly pricing integration — qualifications, validation, DOM injection.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.voucherify
 */
import type { PPLib } from '../types/common.types';
import type { VoucherifyConfig, ValidationContext, QualificationContext, PricingResult, ValidationResult, QualificationResult, OrderItem, DOMProduct, OffersResult, OffersBundle, OfferEntry, OfferCategory, FetchOffersOptions } from '../types/voucherify.types';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: VoucherifyConfig = {
    api: {
      applicationId: '',
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
    }
  };

  // =====================================================
  // API CLIENT
  // =====================================================

  var memCache: Map<string, { data: any; timestamp: number }> = new Map();

  function getCacheKey(endpoint: string, body: any): string {
    try {
      return endpoint + ':' + JSON.stringify(body);
    /*! v8 ignore start — JSON.stringify circular-ref throw is not reachable in normal usage */
    } catch (e) {
      return endpoint + ':' + String(Date.now());
    }
    /*! v8 ignore stop */
  }

  function isCacheValid(key: string): boolean {
    var entry = memCache.get(key);
    if (!entry) return false;
    if ((Date.now() - entry.timestamp) >= CONFIG.cache.ttl) {
      memCache.delete(key);
      return false;
    }
    return true;
  }

  async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    var maxRetries = CONFIG.retry.maxRetries;
    var baseDelay = CONFIG.retry.baseDelay;
    var lastError: any;

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        var response = await win.fetch(url, options);
        // Do not retry on 4xx client errors
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return response;
        }
        // 5xx — retry
        lastError = new Error('HTTP ' + response.status);
      } catch (e) {
        // Network error — retry
        lastError = e;
      }
      if (attempt < maxRetries) {
        await new Promise(function(resolve) {
          win.setTimeout(resolve, baseDelay * Math.pow(2, attempt));
        });
      }
    }
    throw lastError;
  }

  async function apiRequest(endpoint: string, body: any): Promise<any> {
    var cacheKey = getCacheKey(endpoint, body);

    if (isCacheValid(cacheKey)) {
      ppLib.log('info', '[ppVoucherify] Cache hit for ' + endpoint);
      return memCache.get(cacheKey)!.data;
    }

    var apiResponse: Response;

    if (CONFIG.cache.enabled) {
      if (!CONFIG.cache.baseUrl) {
        throw new Error('Voucherify cache.baseUrl is not configured');
      }
      apiResponse = await fetchWithRetry(CONFIG.cache.baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      if (!CONFIG.api.applicationId || !CONFIG.api.clientSecretKey) {
        throw new Error('Voucherify API credentials missing: ' +
          (!CONFIG.api.applicationId ? 'applicationId ' : '') +
          (!CONFIG.api.clientSecretKey ? 'clientSecretKey' : ''));
      }
      /*! v8 ignore start — jsdom location.origin is always http://localhost */
      var origin = CONFIG.api.origin || win.location.origin;
      /*! v8 ignore stop */
      apiResponse = await fetchWithRetry(CONFIG.api.baseUrl + '/client/v1' + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Application-Id': CONFIG.api.applicationId,
          'X-Client-Token': CONFIG.api.clientSecretKey,
          'origin': origin
        },
        body: JSON.stringify(body)
      });
    }

    if (!apiResponse.ok) {
      throw new Error('Voucherify ' + endpoint + ': ' + apiResponse.status);
    }

    var data = await apiResponse.json();

    memCache.set(cacheKey, { data: data, timestamp: Date.now() });

    // Evict stale entries when cache exceeds 50 entries to prevent unbounded growth
    if (memCache.size > 50) {
      var pruneTime = Date.now();
      memCache.forEach(function(entry, key) {
        if ((pruneTime - entry.timestamp) >= CONFIG.cache.ttl) {
          memCache.delete(key);
        }
      });
    }

    return data;
  }

  function apiQualifications(context: any): Promise<any> {
    return apiRequest('/qualifications', context);
  }

  function apiValidations(context: any): Promise<any> {
    return apiRequest('/validations', context);
  }

  function clearCache(): void {
    memCache.clear();
  }

  // =====================================================
  // CONTEXT BUILDER
  // =====================================================

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
        related_object: 'product',
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

  // =====================================================
  // PRICING ENGINE
  // =====================================================

  var priceFormatter: Intl.NumberFormat | null = null;

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
      var percent = Math.round((discountAmount / basePrice) * 100);
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
    response: any
  ): PricingResult[] {
    var results: PricingResult[] = [];
    var redeemablesRaw = (response && response.qualifications) || (response && response.redeemables) || [];
    var redeemables = Array.isArray(redeemablesRaw) ? redeemablesRaw : (redeemablesRaw.data || []);

    for (var i = 0; i < productIds.length; i++) {
      var productId = productIds[i];
      var domProduct = products.find(function(p) { return p.id === productId; });
      var basePrice = domProduct ? domProduct.basePrice : 0;
      var bestDiscount = 0;
      var bestType: PricingResult['discountType'] = 'NONE';
      var applicableVouchers: string[] = [];
      var campaignName: string | undefined;

      for (var j = 0; j < redeemables.length; j++) {
        var redeemable = redeemables[j];
        var discount = redeemable.result && redeemable.result.discount;
        if (!discount) continue;

        // UNIT discounts with ADD_MISSING_ITEMS add a free product (e.g. shipping),
        // they don't reduce the current product's price
        if (discount.type === 'UNIT' && discount.effect === 'ADD_MISSING_ITEMS') continue;

        var discountAmount = 0;
        var discountType: PricingResult['discountType'] = 'NONE';

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

      var discountedPrice = Math.max(0, basePrice - bestDiscount);
      var discountLabel = bestType !== 'NONE' ? buildDiscountLabel(bestType, bestDiscount, basePrice) : '';

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
    for (var i = 0; i < products.length; i++) {
      var product = products[i];
      var result = pricingResults.find(function(r) { return r.productId === product.id; });
      if (!result) continue;

      var el = product.element;

      // Inject original price
      var originalEl = el.querySelector('[' + CONFIG.pricing.originalPriceAttribute + ']');
      if (originalEl) originalEl.textContent = formatPrice(product.basePrice);

      // Inject discounted price
      var discountedEl = el.querySelector('[' + CONFIG.pricing.discountedPriceAttribute + ']');
      if (discountedEl) {
        discountedEl.textContent = result.discountedPrice < product.basePrice
          ? formatPrice(result.discountedPrice)
          : formatPrice(product.basePrice);
      }

      // Inject discount label (optional)
      var labelEl = el.querySelector('[' + CONFIG.pricing.discountLabelAttribute + ']');
      if (labelEl) {
        labelEl.textContent = result.discountLabel || '';
      }
    }
  }

  // =====================================================
  // EDGE MODE
  // =====================================================

  function determineSegment(): string {
    var sourceId = ppLib.getCookie(CONFIG.context.customerSourceIdCookie);
    if (sourceId) return 'member';
    return 'anonymous';
  }

  function addLoadingClass(products: DOMProduct[]): void {
    for (var i = 0; i < products.length; i++) {
      products[i].element.classList.add('pp-voucherify-loading');
    }
  }

  function removeLoadingClass(products: DOMProduct[]): void {
    for (var i = 0; i < products.length; i++) {
      products[i].element.classList.remove('pp-voucherify-loading');
    }
  }

  async function fetchPricingEdge(products: DOMProduct[], ids: string[]): Promise<PricingResult[]> {
    var segment = determineSegment();
    var basePrices = ids.map(function(id) {
      var p = products.find(function(dp) { return dp.id === id; });
      return p ? p.basePrice : 0;
    });

    var url = CONFIG.edge.edgeUrl + '/api/prices/' + encodeURIComponent(segment) +
      '?products=' + encodeURIComponent(ids.join(',')) +
      '&basePrices=' + encodeURIComponent(basePrices.join(','));

    var response = await win.fetch(url);
    if (!response.ok) {
      throw new Error('Edge API error: ' + response.status);
    }

    var data = await response.json();
    var pricingProducts: Record<string, any> = data.products || {};

    var results: PricingResult[] = [];
    for (var i = 0; i < ids.length; i++) {
      var entry = pricingProducts[ids[i]];
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
        var bp = basePrices[i];
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

  async function edgeValidateVoucher(code: string, body: any): Promise<any> {
    var response = await win.fetch(CONFIG.edge.edgeUrl + '/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Edge validate error: ' + response.status);
    return response.json();
  }

  async function edgeCheckQualifications(body: any): Promise<any> {
    var response = await win.fetch(CONFIG.edge.edgeUrl + '/api/qualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Edge qualify error: ' + response.status);
    return response.json();
  }

  var inflightPricing: Promise<PricingResult[]> | null = null;

  async function fetchPricingImpl(productIds?: string[]): Promise<PricingResult[]> {
    try {
      var products = getProductsFromDOM();
      var ids = productIds || products.map(function(p) { return p.id; });
      if (ids.length === 0) return [];

      // CMS mode: anonymous users already have prices in HTML from CMS.
      // Only fetch from edge for members on pages that opt in.
      if (CONFIG.edge.mode === 'cms') {
        var segment = determineSegment();
        if (segment === 'anonymous') {
          return [];
        }
        // Member: check page opt-in attribute
        var pageOptIn = doc.querySelector('[data-voucherify-member-pricing]');
        if (!pageOptIn) {
          return [];
        }
        // Member + opt-in: fetch from edge
        addLoadingClass(products);
        try {
          var cmsEdgeResults = await fetchPricingEdge(products, ids);
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
          var edgeResults = await fetchPricingEdge(products, ids);
          injectPricing(products, edgeResults);
          removeLoadingClass(products);
          ppLib.log('info', '[ppVoucherify] Edge pricing fetched for ' + ids.length + ' product(s)');
          return edgeResults;
        } catch (e) {
          ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
          removeLoadingClass(products);
          // Fall through to direct API
        }
      }

      var customer = buildCustomer();
      var items = buildOrderItems(ids);

      var body: any = {
        order: { items: items },
        scenario: 'ALL'
      };
      if (customer) body.customer = customer;

      var response = await apiQualifications(body);

      var results = mapQualificationsToResults(ids, products, response);

      injectPricing(products, results);

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

  var inflightOffers: Promise<OffersResult> | null = null;

  var ALL_CATEGORIES: OfferCategory[] = ['coupon', 'promotion', 'loyalty', 'referral', 'gift'];

  function emptyBundle(): OffersBundle {
    return { coupons: [], promotions: [], loyalty: [], referrals: [], gifts: [] };
  }

  function emptyResult(segment: string): OffersResult {
    return { segment: segment, offers: emptyBundle(), timestamp: Date.now() };
  }

  async function fetchOffersEdge(segment: string): Promise<OffersBundle> {
    var url = CONFIG.edge.edgeUrl + '/api/offers/' + encodeURIComponent(segment);
    var response = await fetchWithRetry(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error('Edge offers API error: ' + response.status);
    }
    var data = await response.json();
    return data.offers || emptyBundle();
  }

  function categorizeRedeemable(r: any): OfferCategory {
    if (r.object === 'promotion_tier' || r.object === 'promotion_stack') return 'promotion';
    if (r.object === 'loyalty_card') return 'loyalty';
    if (r.campaign_type === 'REFERRAL_PROGRAM') return 'referral';
    if (r.result && r.result.gift) return 'gift';
    return 'coupon';
  }

  function buildOfferEntryFromRedeemable(r: any): OfferEntry {
    var category = categorizeRedeemable(r);
    var discount = r.result && r.result.discount;
    var entry: OfferEntry = {
      id: r.id,
      category: category,
      title: r.campaign_name || r.campaign || '',
      description: '',
      applicableProductIds: []
    };

    if (r.voucher && r.voucher.code) entry.code = r.voucher.code;

    if (discount) {
      var discountLabel = '';
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

    if (r.campaign_name) entry.campaignName = r.campaign_name;

    return entry;
  }

  function categorizeRedeemables(redeemables: any[]): OffersBundle {
    var bundle = emptyBundle();
    for (var i = 0; i < redeemables.length; i++) {
      var entry = buildOfferEntryFromRedeemable(redeemables[i]);
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
    var seenIds: Record<string, boolean> = {};
    var merged = emptyBundle();

    function addUnique(target: OfferEntry[], source: OfferEntry[]) {
      for (var i = 0; i < source.length; i++) {
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
    var filtered = emptyBundle();
    if (categories.indexOf('coupon') >= 0) filtered.coupons = bundle.coupons.slice(0, maxPerCategory);
    if (categories.indexOf('promotion') >= 0) filtered.promotions = bundle.promotions.slice(0, maxPerCategory);
    if (categories.indexOf('loyalty') >= 0) filtered.loyalty = bundle.loyalty.slice(0, maxPerCategory);
    if (categories.indexOf('referral') >= 0) filtered.referrals = bundle.referrals.slice(0, maxPerCategory);
    if (categories.indexOf('gift') >= 0) filtered.gifts = bundle.gifts.slice(0, maxPerCategory);
    return filtered;
  }

  function renderOffers(bundle: OffersBundle): void {
    var containerAttr = CONFIG.offers.containerAttribute;
    var containers = doc.querySelectorAll('[' + containerAttr + ']');

    for (var c = 0; c < containers.length; c++) {
      var container = containers[c];
      var categoryFilter = container.getAttribute(containerAttr) || 'all';
      var requestedCategories: OfferCategory[] = categoryFilter === 'all'
        ? ALL_CATEGORIES
        : categoryFilter.split(',').map(function(s) { return s.trim() as OfferCategory; });

      // Find template
      var template = container.querySelector('[' + CONFIG.offers.templateAttribute + ']') as HTMLElement | null;
      if (template) {
        template.style.display = 'none';
      }

      // Remove previous clones
      var oldClones = container.querySelectorAll('.pp-voucherify-offer-clone');
      for (var r = 0; r < oldClones.length; r++) {
        oldClones[r].parentNode!.removeChild(oldClones[r]);
      }

      // Collect matching offers
      var offers: OfferEntry[] = [];
      for (var k = 0; k < requestedCategories.length; k++) {
        var cat = requestedCategories[k];
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
        for (var i = 0; i < offers.length; i++) {
          var offer = offers[i];
          var clone = template.cloneNode(true) as HTMLElement;
          clone.removeAttribute(CONFIG.offers.templateAttribute);
          clone.classList.add('pp-voucherify-offer-clone');
          clone.classList.add('pp-voucherify-offer-' + offer.category);
          clone.style.display = '';

          // Populate slots
          var titleEl = clone.querySelector('[' + CONFIG.offers.offerTitleAttribute + ']');
          if (titleEl) titleEl.textContent = offer.title;

          var descEl = clone.querySelector('[' + CONFIG.offers.offerDescriptionAttribute + ']');
          if (descEl) descEl.textContent = offer.description;

          var codeEl = clone.querySelector('[' + CONFIG.offers.offerCodeAttribute + ']') as HTMLElement | null;
          if (codeEl) {
            if (offer.code) {
              codeEl.textContent = offer.code;
              codeEl.style.display = '';
            } else {
              codeEl.style.display = 'none';
            }
          }

          var discountEl = clone.querySelector('[' + CONFIG.offers.offerDiscountAttribute + ']');
          if (discountEl) discountEl.textContent = (offer.discount && offer.discount.label) || '';

          var categoryEl = clone.querySelector('[' + CONFIG.offers.offerCategoryAttribute + ']');
          if (categoryEl) categoryEl.textContent = offer.category;

          var loyaltyEl = clone.querySelector('[' + CONFIG.offers.offerLoyaltyBalanceAttribute + ']');
          if (loyaltyEl) loyaltyEl.textContent = offer.loyalty ? String(offer.loyalty.balance) + ' pts' : '';

          var giftEl = clone.querySelector('[' + CONFIG.offers.offerGiftBalanceAttribute + ']');
          if (giftEl) giftEl.textContent = offer.gift ? formatPrice(offer.gift.balance / 100) : '';

          container.appendChild(clone);
        }
      }

      // Toggle empty state
      var emptyEl = container.querySelector('[' + CONFIG.offers.emptyStateAttribute + ']') as HTMLElement | null;
      if (emptyEl) {
        emptyEl.style.display = offers.length === 0 ? '' : 'none';
      }
    }
  }

  function addOffersLoadingClass(): void {
    var containers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']');
    for (var i = 0; i < containers.length; i++) {
      containers[i].classList.add('pp-voucherify-offers-loading');
    }
  }

  function removeOffersLoadingClass(): void {
    var containers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']');
    for (var i = 0; i < containers.length; i++) {
      containers[i].classList.remove('pp-voucherify-offers-loading');
    }
  }

  async function fetchOffersImpl(options?: FetchOffersOptions): Promise<OffersResult> {
    try {
      var segment = determineSegment();
      var categories = (options && options.categories != null) ? options.categories : CONFIG.offers.categories;
      var maxPerCategory = (options && options.maxPerCategory != null) ? options.maxPerCategory : CONFIG.offers.maxPerCategory;
      var personalize = (options && options.personalize != null) ? options.personalize : CONFIG.offers.personalizeForMember;

      // CMS mode: anonymous → return empty (offers from CMS already in HTML if needed)
      if (CONFIG.edge.mode === 'cms') {
        if (segment === 'anonymous') {
          return emptyResult(segment);
        }
        // Member: check page opt-in
        var memberOptIn = doc.querySelector('[data-voucherify-member-offers]');
        if (!memberOptIn) {
          return emptyResult(segment);
        }
      }

      addOffersLoadingClass();

      var bundle: OffersBundle;
      try {
        if (CONFIG.edge.mode === 'edge' || CONFIG.edge.mode === 'cms') {
          bundle = await fetchOffersEdge(segment);
        } else {
          // direct mode
          var customer = buildCustomer();
          var body: any = { scenario: 'ALL' };
          if (customer) body.customer = customer;
          var response = await apiQualifications(body);
          var redeemablesRaw = (response && response.qualifications) || (response && response.redeemables) || [];
          var redeemables = Array.isArray(redeemablesRaw) ? redeemablesRaw : (redeemablesRaw.data || []);
          bundle = categorizeRedeemables(redeemables);
        }

        // Personal wallet merge
        if (personalize && segment === 'member') {
          var walletCustomer = buildCustomer();
          if (walletCustomer) {
            var walletBody: any = { scenario: 'CUSTOMER_WALLET', customer: walletCustomer };
            var walletResponse = await apiQualifications(walletBody);
            var walletRaw = (walletResponse && walletResponse.qualifications) || (walletResponse && walletResponse.redeemables) || [];
            var walletRedeemables = Array.isArray(walletRaw) ? walletRaw : (walletRaw.data || []);
            var personalBundle = categorizeRedeemables(walletRedeemables);
            bundle = mergeOffersBundles(bundle, personalBundle);
          }
        }

        var filtered = filterBundle(bundle, categories, maxPerCategory);

        // Auto-render if containers exist
        var hasContainers = doc.querySelectorAll('[' + CONFIG.offers.containerAttribute + ']').length > 0;
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

  var initialized = false;

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

    // Warn about exposed credentials in direct API mode
    if (!CONFIG.cache.enabled && CONFIG.api.clientSecretKey) {
      ppLib.log('warn', '[ppVoucherify] Direct API mode exposes credentials in browser. Use cache proxy (cache.enabled: true) for production.');
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
        var sanitizedCode = ppLib.Security.sanitize(code);
        if (!sanitizedCode) {
          return Promise.resolve({ valid: false, code: code, reason: 'Empty voucher code' });
        }

        var body: any = {
          redeemables: [{ object: 'voucher', id: sanitizedCode }]
        };

        if (context && context.customer) {
          body.customer = context.customer;
        }
        if (context && context.order) {
          body.order = context.order;
        }

        var validateFn: (b: any) => Promise<any>;
        if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
          validateFn = function(b: any) {
            return edgeValidateVoucher(sanitizedCode, b).catch(function(e: any) {
              ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
              return apiValidations(b);
            });
          };
        } else {
          validateFn = apiValidations;
        }

        return validateFn(body).then(function(response: any) {
          var redeemable = response.redeemables && response.redeemables[0];
          var result = redeemable && redeemable.result;

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
      var body = context || { scenario: 'ALL' };

      var qualifyFn: (b: any) => Promise<any>;
      if (CONFIG.edge.mode === 'edge' && CONFIG.edge.edgeUrl) {
        qualifyFn = function(b: any) {
          return edgeCheckQualifications(b).catch(function(e: any) {
            ppLib.log('warn', '[ppVoucherify] Edge service unavailable, falling back to direct API');
            return apiQualifications(b);
          });
        };
      } else {
        qualifyFn = apiQualifications;
      }

      return qualifyFn(body).then(function(response: any) {
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
