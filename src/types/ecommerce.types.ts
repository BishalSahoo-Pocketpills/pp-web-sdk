export interface EcommerceDefaults {
  brand: string;
  category: string;
  currency: string;
  quantity: number;
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
  price: string;
  quantity: number;
  variant?: string;
  discount?: string;
  coupon?: string;
}

export interface EcommerceData {
  value: number;
  currency: string;
  items: EcommerceItem[];
}

export interface EcommerceAPI {
  configure: (options?: Partial<EcommerceConfig>) => EcommerceConfig;
  trackViewItem: () => void;
  trackItem: (itemData: Partial<EcommerceItem> & { price: string | number }) => void;
  getItems: () => EcommerceItem[];
  getConfig: () => EcommerceConfig;
}
