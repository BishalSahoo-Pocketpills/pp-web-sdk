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
  };
  defaults: { itemBrand: string; currency: string; platform: string };
  attributes: DataLayerAttributes;
  debounceMs: number;
  navigationDelay: number;
}

// =====================================================
// GLOBAL OBJECTS
// =====================================================

export interface DataLayerUser {
  pp_user_id: string;
  pp_patient_id: string;
  logged_in: boolean;
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
  item_id: string | null;
  item_name: string | null;
  item_brand: string;
  item_category: string | null;
  item_category2: string | null;
  item_category3: string | null;
  item_category4: string | null;
  price: number;
  quantity: number;
  discount: number;
  coupon: string | null;
  currency: string;
}

export interface DataLayerItemInput {
  item_id?: string;
  item_name?: string;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  price?: number | string;
  quantity?: number;
  discount?: number | string;
  coupon?: string;
  currency?: string;
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

export interface UserDataHashedInput {
  sha256_email_address?: string;
  sha256_phone_number?: string;
  address?: Partial<DataLayerUserDataAddress>;
}

// =====================================================
// PUBLIC API
// =====================================================

export interface DataLayerAPI {
  configure: (options?: Partial<DataLayerConfig>) => DataLayerConfig;

  // User context
  setUser: (user: Partial<DataLayerUser>) => void;
  setUserData: (data: UserDataInput) => Promise<void>;
  setUserDataHashed: (data: UserDataHashedInput) => void;

  // Generic push
  push: (eventName: string, data?: Record<string, any>) => void;
  pushEcommerce: (eventName: string, items: DataLayerItemInput[], data?: Record<string, any>) => void;

  // Core events
  pageview: (data?: Record<string, any>) => void;
  loginView: (data: { method: string }) => void;
  loginSuccess: (data: { method: string; pp_user_id?: string; pp_patient_id?: string }) => void;
  signupView: (data: { method: string; signup_flow?: string }) => void;
  signupStart: (data: { method: string }) => void;
  signupComplete: (data: { method: string; pp_user_id?: string; pp_patient_id?: string }) => void;
  search: (data: { search_term: string; results_count?: number; search_type?: string }) => void;

  // Ecommerce events
  viewItem: (items: DataLayerItemInput[]) => void;
  addToCart: (items: DataLayerItemInput[]) => void;
  beginCheckout: (items: DataLayerItemInput[]) => void;
  addPaymentInfo: (items: DataLayerItemInput[]) => void;
  purchase: (transactionId: string, items: DataLayerItemInput[]) => void;

  init: () => void;
  bindDOM: () => void;

  getConfig: () => DataLayerConfig;
}
