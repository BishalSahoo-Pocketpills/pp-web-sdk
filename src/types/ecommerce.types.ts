import type { DeepPartial } from '@src/types/utility.types';

export interface EcommerceDefaults {
  brand: string;
  category: string;
  currency: string;
  quantity: number;
  platform: string;
}

export interface EcommerceAttributes {
  item: string;
  name: string;
  price: string;
  category: string;
  brand: string;
  variant: string;
  discount: string;
  coupon: string;
  quantity: string;
}

export interface EcommercePlatforms {
  mixpanel: { enabled: boolean };
  gtm: { enabled: boolean };
}

export interface EcommerceConfig {
  defaults: EcommerceDefaults;
  attributes: EcommerceAttributes;
  ctaSelector: string;
  debounceMs: number;
  platforms: EcommercePlatforms;
}

export interface EcommerceItem {
  item_id: string;
  item_name: string;
  item_brand: string;
  item_category: string;
  price: number;
  quantity: number;
  variant?: string;
  discount?: number;
  coupon?: string;
}

export interface EcommerceData {
  value: number;
  currency: string;
  items: EcommerceItem[];
  // Index signature so this shape is assignable to Mixpanel.track's
  // Record<string, unknown> parameter without a cast at the call site.
  [key: string]: unknown;
}

export interface EcommerceAPI {
  configure: (options?: DeepPartial<EcommerceConfig>) => EcommerceConfig;
  trackViewItem: () => void;
  trackItem: (itemData: DeepPartial<EcommerceItem> & { price: string | number }) => void;
  getItems: () => EcommerceItem[];
  getConfig: () => EcommerceConfig;
}
