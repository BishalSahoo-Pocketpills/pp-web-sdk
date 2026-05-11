import type { DeepPartial, SdkSecurityOptions } from '@src/types/utility.types';

export interface BrazeSdkConfig extends SdkSecurityOptions {
  apiKey: string;
  baseUrl: string;
  // Hash-generation tip: curl the cdnUrl and pipe to openssl —
  //   curl https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js | openssl dgst -sha384 -binary | openssl base64 -A
  // then prefix with `sha384-` for the `integrity` field. Pin a specific
  // SDK version (replace `5.6` with `5.6.0`) since `5.6` is a moving range.
  cdnUrl: string;
  enableLogging: boolean;
  sessionTimeoutInSeconds: number;
  nonce?: string;
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
  configure: (options?: DeepPartial<BrazeConfig>) => BrazeConfig;
  init: () => void;
  identify: (userId: string) => void;
  setUserAttributes: (attrs: Record<string, unknown>) => void;
  setEmail: (email: string) => void;
  trackEvent: (eventName: string, properties?: Record<string, unknown>) => void;
  trackPurchase: (productId: string, price: number, currency?: string, quantity?: number, properties?: Record<string, unknown>) => void;
  flush: () => void;
  isReady: () => boolean;
  getConfig: () => BrazeConfig;
}
