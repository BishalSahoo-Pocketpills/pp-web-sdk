import type { DeepPartial } from '@src/types/utility.types';

// =====================================================
// CONFIGURATION
// =====================================================

export interface DataLayerAttributes {
  event: string;
  method: string;
  pageType: string;
  signupFlow: string;
  searchTerm: string;
  resultsCount: string;
  searchType: string;
  itemId: string;
  itemName: string;
  itemBrand: string;
  itemCategory: string;
  price: string;
  quantity: string;
  discount: string;
  coupon: string;
  currency: string;
  transactionId: string;
  viewItem: string;
}

export interface DataLayerConfig {
  cookieNames: {
    userId: string;
    patientId: string;
    firstName: string;
    lastName: string;
    appAuth: string;
    email: string;
    phone: string;
    street: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    previousUser: string;
  };
  defaults: { itemBrand: string; currency: string; platform: string };
  attributes: DataLayerAttributes;
  debounceMs: number;
  navigationDelay: number;
  initDelay: number;
  autoViewItem: boolean;
  /**
   * 3E: when `true`, null / undefined / '' values in user + event properties
   * are passed through to the dataLayer unchanged (opt-out). When `false`
   * (default), the enricher strips them to match Mixpanel's behavior so
   * downstream consumers don't see "(empty)" segments. Set to `true` only
   * when a GTM consumer relies on explicit nulls — most teams should leave
   * the default.
   */
  preserveEmptyProperties: boolean;
  // Allowlist for cross-origin redirects from `<a data-dl-event>` clicks.
  // Same-origin / relative hrefs are always allowed; cross-origin hrefs
  // must match an entry exactly or as a subdomain (`.host` suffix).
  allowedRedirectHosts: string[];
}

// =====================================================
// GLOBAL OBJECTS
// =====================================================

export interface DataLayerUser {
  pp_user_id: number | null;
  pp_patient_id: number | null;
  // Stringified boolean ("true" / "false") per the event-attribute
  // contract — Mixpanel + GTM consumers treat this as a categorical
  // string, not a boolean.
  logged_in: string;
}

export interface DataLayerUserDataAddress {
  sha256_first_name: string;
  sha256_last_name: string;
  sha256_street: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
}

export interface DataLayerUserData {
  sha256_email_address: string;
  sha256_phone_number: string;
  address: DataLayerUserDataAddress;
}

export interface DataLayerPage {
  url: string;
  title: string;
  referrer: string;
}

// =====================================================
// ITEM OBJECTS
// =====================================================

export interface DataLayerItem {
  item_id: string;
  item_name: string;
  item_brand: string;
  item_category?: string;
  price: number;
  quantity: number;
  discount: number;
  coupon: string;
}

export interface DataLayerItemInput {
  item_id?: string;
  item_name?: string;
  item_brand?: string;
  item_category?: string;
  price?: number | string;
  quantity?: number;
  discount?: number | string;
  coupon?: string;
}

// =====================================================
// USER DATA INPUT
// =====================================================

export interface UserDataInput {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  street?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

/**
 * Pre-hashed user data for `setUserDataHashed`. Each `sha256_*` field MUST be a
 * 64-character hex SHA-256 digest; any value not matching that shape is dropped
 * to '' (and a warning is logged) — this guards against cleartext PII being
 * accidentally placed in a hashed field. Plain address fields (city/region/
 * postal_code/country) are passed through as-is.
 */
export interface UserDataHashedInput {
  sha256_email_address?: string;
  sha256_phone_number?: string;
  address?: Partial<DataLayerUserDataAddress>;
}

// =====================================================
// PUBLIC API
// =====================================================

export interface DataLayerAPI {
  configure: (options?: DeepPartial<DataLayerConfig>) => DataLayerConfig;

  // User context
  setUser: (user: DeepPartial<DataLayerUser>) => void;
  setUserData: (data: UserDataInput) => Promise<void>;
  setUserDataHashed: (data: UserDataHashedInput) => void;

  // Generic push
  push: (eventName: string, data?: Record<string, unknown>) => void;
  pushEcommerce: (eventName: string, items: DataLayerItemInput[], data?: Record<string, unknown>) => void;

  // Core events
  pageview: (data?: Record<string, unknown>) => void;
  loginView: (data: { method: string }) => void;
  loginSuccess: (data: { method: string; pp_user_id?: number; pp_patient_id?: number }) => void;
  signupView: (data: { method: string; signup_flow?: string }) => void;
  signupStart: (data: { method: string }) => void;
  signupComplete: (data: { method: string; pp_user_id?: number; pp_patient_id?: number }) => void;
  search: (data: { search_term: string; results_count?: number; search_type?: string }) => void;

  // Ecommerce events
  viewItem: (items: DataLayerItemInput[]) => void;
  addToCart: (items: DataLayerItemInput[]) => void;
  beginCheckout: (items: DataLayerItemInput[]) => void;
  addPaymentInfo: (items: DataLayerItemInput[]) => void;
  purchase: (transactionId: string, items: DataLayerItemInput[]) => void;

  init: () => void;
  bindDOM: () => void;
  scanViewItems: () => void;

  getConfig: () => DataLayerConfig;
}
