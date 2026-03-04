export interface BrazeSdkConfig {
  apiKey: string;
  baseUrl: string;
  cdnUrl: string;
  enableLogging: boolean;
  sessionTimeoutInSeconds: number;
}

export interface BrazeConsentConfig {
  required: boolean;
  mode: 'analytics' | 'custom';
  checkFunction: () => boolean;
}

export interface BrazeIdentityConfig {
  autoIdentify: boolean;
  userIdCookie: string;
  emailCookie: string;
}

export interface BrazeFormConfig {
  formAttribute: string;
  fieldAttribute: string;
  formEventAttribute: string;
  preventDefault: boolean;
  debounceMs: number;
  flushOnSubmit: boolean;
  requireEmail: boolean;
  identifyByEmail: boolean;
}

export interface BrazeEventConfig {
  eventAttribute: string;
  propPrefix: string;
  debounceMs: number;
  includePageContext: boolean;
}

export interface BrazePurchaseConfig {
  bridgeEcommerce: boolean;
  defaultCurrency: string;
}

export interface BrazeConfig {
  sdk: BrazeSdkConfig;
  consent: BrazeConsentConfig;
  identity: BrazeIdentityConfig;
  form: BrazeFormConfig;
  event: BrazeEventConfig;
  purchase: BrazePurchaseConfig;
  attributeMap: Record<string, string>;
}

export interface BrazeAPI {
  configure: (options?: Partial<BrazeConfig>) => BrazeConfig;
  init: () => void;
  identify: (userId: string) => void;
  setUserAttributes: (attrs: Record<string, any>) => void;
  setEmail: (email: string) => void;
  trackEvent: (eventName: string, properties?: Record<string, any>) => void;
  trackPurchase: (productId: string, price: number, currency?: string, quantity?: number, properties?: Record<string, any>) => void;
  flush: () => void;
  isReady: () => boolean;
  getConfig: () => BrazeConfig;
}
