/**
 * Voucherify offers manager.
 *
 * Resolves the visitor's offer bundle (coupons, promotions, loyalty,
 * referrals, gifts), merges base + personal wallet for members, and
 * renders into Webflow-style template containers.
 *
 * Three transport branches mirror pricing-engine:
 *   - `edge` / `cms` mode → Worker `/api/offers/<segment>` endpoint.
 *   - Direct mode → Voucherify qualifications API with `scenario: 'ALL'`.
 *   - `personalize: true` for members layers in `CUSTOMER_WALLET` calls.
 *
 * Extracted from voucherify/index.ts; all closure state is threaded as
 * factory dependencies (CONFIG, ppLib, formatter, segment resolver).
 */

import type { PPLib } from '@src/types/common.types';
import type {
  VoucherifyConfig,
  OffersResult,
  OffersBundle,
  OfferEntry,
  OfferCategory,
  FetchOffersOptions,
  VoucherifyRedeemable,
  VoucherifyApiResponse,
  CustomerMetadata,
} from '@src/types/voucherify.types';
import { VoucherifyApiError } from '@src/voucherify/errors';
import type { PriceFormatter } from '@src/voucherify/formatters';

type Customer = { source_id: string; metadata?: CustomerMetadata };

export interface OffersManagerDeps {
  win: Window & typeof globalThis;
  doc: Document;
  ppLib: PPLib;
  CONFIG: VoucherifyConfig;
  /** Live formatter accessor — rebuilt by configure(), so resolve lazily. */
  getFormatter: () => PriceFormatter;
  apiQualifications: (body: Record<string, unknown>) => Promise<VoucherifyApiResponse>;
  fetchWithRetry: (url: string, options: RequestInit) => Promise<Response>;
  determineSegment: () => string;
  buildCustomer: () => Customer | undefined;
  extractRedeemables: (response: VoucherifyApiResponse) => VoucherifyRedeemable[];
}

export interface OffersManager {
  fetchOffers: (options?: FetchOffersOptions) => Promise<OffersResult>;
}

const ALL_CATEGORIES: OfferCategory[] = ['coupon', 'promotion', 'loyalty', 'referral', 'gift'];

export function createOffersManager(deps: OffersManagerDeps): OffersManager {
  const {
    doc,
    ppLib,
    CONFIG,
    getFormatter,
    apiQualifications,
    fetchWithRetry,
    determineSegment,
    buildCustomer,
    extractRedeemables,
  } = deps;

  function formatPrice(amount: number): string {
    return getFormatter().format(amount);
  }

  let inflightOffers: Promise<OffersResult> | null = null;

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

  return {
    fetchOffers,
  };
}
