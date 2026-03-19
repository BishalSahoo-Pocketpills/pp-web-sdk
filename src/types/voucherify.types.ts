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
  mode: 'direct' | 'edge';
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

export interface VoucherifyConfig {
  api: VoucherifyApiConfig;
  cache: VoucherifyCacheConfig;
  edge: VoucherifyEdgeConfig;
  pricing: VoucherifyPricingConfig;
  context: VoucherifyContextConfig;
  consent: VoucherifyConsentConfig;
  retry: VoucherifyRetryConfig;
}

export interface OrderItem {
  product_id?: string;
  sku_id?: string;
  source_id?: string;
  related_object?: 'product' | 'sku';
  quantity?: number;
  price?: number;
}

export interface QualificationContext {
  customer?: { source_id?: string; metadata?: Record<string, any> };
  order?: { amount?: number; items?: OrderItem[] };
  scenario?: 'ALL' | 'CUSTOMER_WALLET' | 'AUDIENCE_ONLY' | 'PRODUCTS';
  metadata?: Record<string, any>;
}

export interface ValidationContext {
  redeemables: Array<{ object: string; id: string }>;
  customer?: { source_id?: string; metadata?: Record<string, any> };
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
  redeemables: Array<{
    id: string;
    object: string;
    result?: { discount?: any; gift?: any; loyalty?: any };
    applicable_to?: any;
  }>;
  total: number;
  hasMore: boolean;
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
  validateVoucher: (code: string, context?: Partial<ValidationContext>) => Promise<ValidationResult>;
  checkQualifications: (context?: QualificationContext) => Promise<QualificationResult>;
  clearCache: () => void;
  isReady: () => boolean;
  getConfig: () => VoucherifyConfig;
}
