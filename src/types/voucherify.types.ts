export interface VoucherifyApiConfig {
  applicationId: string;
  clientSecretKey: string;
  baseUrl: string;
  origin: string;
}

export interface VoucherifyCacheConfig {
  enabled: boolean;
  baseUrl: string;
  ttl: number;
}

export interface VoucherifyEdgeConfig {
  mode: 'direct' | 'edge' | 'cms';
  edgeUrl: string;
}

export interface VoucherifyPricingConfig {
  autoFetch: boolean;
  productAttribute: string;
  originalPriceAttribute: string;
  discountedPriceAttribute: string;
  discountLabelAttribute: string;
  priceAttribute: string;
  currencySymbol: string;
  currency: string;
  locale: string;
}

export interface VoucherifyContextConfig {
  customerSourceIdCookie: string;
  includeUtmParams: boolean;
  includeLoginState: boolean;
}

export interface VoucherifyConsentConfig {
  required: boolean;
  mode: 'analytics' | 'custom';
  checkFunction: () => boolean;
}

export interface VoucherifyRetryConfig {
  maxRetries: number;
  baseDelay: number;
}

export interface SegmentRule {
  param: string;
  value: string;
  segment: string;
}

export interface VoucherifySegmentConfig {
  rules: SegmentRule[];
  cookieName: string;
  cookieMaxAgeMinutes: number;
  prioritizeOverMember: boolean;
}

export interface VoucherifyConfig {
  api: VoucherifyApiConfig;
  cache: VoucherifyCacheConfig;
  edge: VoucherifyEdgeConfig;
  pricing: VoucherifyPricingConfig;
  offers: VoucherifyOffersConfig;
  context: VoucherifyContextConfig;
  consent: VoucherifyConsentConfig;
  retry: VoucherifyRetryConfig;
  segments: VoucherifySegmentConfig;
}

export interface OrderItem {
  product_id?: string;
  sku_id?: string;
  source_id?: string;
  related_object?: 'product' | 'sku';
  quantity?: number;
  price?: number;
}

// --- Voucherify API types (shared shapes) ---

/** Discount structure from Voucherify API */
export interface VoucherifyDiscountResult {
  type: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT';
  percent_off?: number;
  amount_off?: number;
  fixed_amount?: number;
  unit_off?: number;
  effect?: string;
}

/** Loyalty card from Voucherify API */
export interface VoucherifyLoyaltyResult {
  points: number;
  balance: number;
  next_expiration_date?: string;
  next_expiration_points?: number;
}

/** Gift card from Voucherify API */
export interface VoucherifyGiftResult {
  amount: number;
  balance: number;
}

/** Order result from Voucherify API */
export interface VoucherifyOrderResult {
  amount: number;
  discount_amount: number;
  total_amount: number;
}

/** Redeemable object from Voucherify qualification/validation responses */
export interface VoucherifyRedeemable {
  id: string;
  object: string;
  name?: string;
  campaign?: string;
  campaign_name?: string;
  campaign_type?: string;
  banner?: string;
  status?: string;
  voucher?: { code?: string };
  result?: {
    discount?: VoucherifyDiscountResult;
    loyalty_card?: VoucherifyLoyaltyResult;
    gift?: VoucherifyGiftResult;
    order?: VoucherifyOrderResult;
  };
  applicable_to?: {
    data?: Array<{ object: string; id?: string; source_id?: string }>;
    total?: number;
  };
  metadata?: Record<string, unknown>;
}

/** Voucherify qualification/validation API response (polymorphic shape) */
export interface VoucherifyApiResponse {
  qualifications?: VoucherifyRedeemable[] | { data: VoucherifyRedeemable[]; total?: number };
  redeemables?: VoucherifyRedeemable[] | { data: VoucherifyRedeemable[]; total?: number };
  valid?: boolean;
  tracking_id?: string;
  total?: number;
  has_more?: boolean;
}

/** Edge pricing API response */
export interface EdgePricingResponse {
  segment: string;
  products: Record<string, {
    basePrice: number;
    discountedPrice: number;
    discountAmount: number;
    discountLabel: string;
    discountType: PricingResult['discountType'];
    applicableVouchers: string[];
    campaignName?: string;
  }>;
  timestamp: number;
}

export type CustomerMetadata = Record<string, string | boolean | number>;

export interface QualificationContext {
  customer?: { source_id?: string; metadata?: CustomerMetadata };
  order?: { amount?: number; items?: OrderItem[] };
  scenario?: 'ALL' | 'CUSTOMER_WALLET' | 'AUDIENCE_ONLY' | 'PRODUCTS';
  metadata?: CustomerMetadata;
}

export interface ValidationContext {
  redeemables: Array<{ object: string; id: string }>;
  customer?: { source_id?: string; metadata?: CustomerMetadata };
  order?: { amount?: number; items?: OrderItem[] };
}

export interface PricingResult {
  productId: string;
  basePrice: number;
  discountedPrice: number;
  discountAmount: number;
  discountLabel: string;
  discountType: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT' | 'NONE';
  applicableVouchers: string[];
  campaignName?: string;
}

export interface ValidationResult {
  valid: boolean;
  code: string;
  discount?: { type: string; amount_off?: number; percent_off?: number };
  reason?: string;
  order?: { amount: number; discount_amount: number; total_amount: number };
}

export interface QualificationResult {
  redeemables: VoucherifyRedeemable[];
  total: number;
  hasMore: boolean;
}

// --- Offer types ---

export type OfferCategory = 'coupon' | 'promotion' | 'loyalty' | 'referral' | 'gift';

export interface OfferDiscount {
  type: 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT' | 'NONE';
  percentOff?: number;
  amountOff?: number;
  fixedAmount?: number;
  unitOff?: number;
  label: string;
}

export interface OfferEntry {
  id: string;
  category: OfferCategory;
  title: string;
  description: string;
  code?: string;
  discount?: OfferDiscount;
  loyalty?: {
    points: number;
    balance: number;
    nextExpirationDate?: string;
    nextExpirationPoints?: number;
  };
  gift?: { amount: number; balance: number };
  campaignName?: string;
  applicableProductIds: string[];
  metadata?: Record<string, unknown>;
}

export interface OffersBundle {
  coupons: OfferEntry[];
  promotions: OfferEntry[];
  loyalty: OfferEntry[];
  referrals: OfferEntry[];
  gifts: OfferEntry[];
}

export interface OffersResult {
  segment: string;
  offers: OffersBundle;
  timestamp: number;
}

export interface FetchOffersOptions {
  categories?: OfferCategory[];
  maxPerCategory?: number;
  personalize?: boolean;
}

export interface VoucherifyOffersConfig {
  autoFetch: boolean;
  containerAttribute: string;
  templateAttribute: string;
  offerTitleAttribute: string;
  offerDescriptionAttribute: string;
  offerCodeAttribute: string;
  offerDiscountAttribute: string;
  offerCategoryAttribute: string;
  offerLoyaltyBalanceAttribute: string;
  offerGiftBalanceAttribute: string;
  emptyStateAttribute: string;
  categories: OfferCategory[];
  maxPerCategory: number;
  personalizeForMember: boolean;
}

export interface DOMProduct {
  id: string;
  basePrice: number;
  element: Element;
}

export interface VoucherifyAPI {
  configure: (options?: Partial<VoucherifyConfig>) => VoucherifyConfig;
  init: () => void;
  fetchPricing: (productIds?: string[]) => Promise<PricingResult[]>;
  fetchOffers: (options?: FetchOffersOptions) => Promise<OffersResult>;
  validateVoucher: (code: string, context?: Partial<ValidationContext>) => Promise<ValidationResult>;
  checkQualifications: (context?: QualificationContext) => Promise<QualificationResult>;
  clearCache: () => void;
  isReady: () => boolean;
  getConfig: () => VoucherifyConfig;
  getSegment: () => string;
}
