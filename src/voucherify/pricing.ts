import type { PPLib } from '../types/common.types';
import type { VoucherifyConfig, PricingResult } from '../types/voucherify.types';
import type { DOMProduct } from './context';

export function createPricingEngine(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig,
  apiClient: ReturnType<typeof import('./api-client').createApiClient>,
  contextBuilder: ReturnType<typeof import('./context').createContextBuilder>
) {
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
    /*! v8 ignore start */
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

  async function fetchPricing(productIds?: string[]): Promise<PricingResult[]> {
    try {
      var products = contextBuilder.getProductsFromDOM();
      var ids = productIds || products.map(function(p) { return p.id; });
      if (ids.length === 0) return [];

      var customer = contextBuilder.buildCustomer();
      var items = contextBuilder.buildOrderItems(ids);

      var body: any = {
        order: { items: items },
        scenario: 'ALL'
      };
      if (customer) body.customer = customer;

      var response = await apiClient.qualifications(body);

      var results = mapQualificationsToResults(ids, products, response);

      injectPricing(products, results);

      ppLib.log('info', '[ppVoucherify] Pricing fetched for ' + ids.length + ' product(s)');

      return results;
    } catch (e) {
      ppLib.log('error', '[ppVoucherify] fetchPricing error', e);
      return [];
    }
  }

  return {
    fetchPricing: fetchPricing,
    injectPricing: injectPricing,
    formatPrice: formatPrice,
    mapQualificationsToResults: mapQualificationsToResults
  };
}
