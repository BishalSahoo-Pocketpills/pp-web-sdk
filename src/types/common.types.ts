export interface SecurityConfig {
  maxParamLength: number;
  maxStorageSize: number;
  maxUrlLength: number;
  enableSanitization: boolean;
  strictMode: boolean;
}

export interface PPLibConfig {
  debug: boolean;
  verbose: boolean;
  namespace: string;
  security: SecurityConfig;
}

export interface SafeUtils {
  get: (obj: any, path: string, defaultValue?: any) => any;
  set: (obj: any, path: string, value: any) => boolean;
  toString: (val: any) => string;
  exists: (val: any) => boolean;
  toArray: (val: any) => any[];
  forEach: (arr: any[], callback: (item: any, index: number, arr: any[]) => void) => void;
}

export interface SecurityJson {
  parse: (str: string, fallback?: any) => any;
  stringify: (obj: any) => string | null;
}

export interface Security {
  sanitize: (input: any) => string;
  isValidUrl: (url: string) => boolean;
  json: SecurityJson;
  validateData: (data: any) => boolean;
}

export interface Storage {
  isAvailable: (type?: string) => boolean;
  getKey: (key: string) => string;
  set: (key: string, value: any, persistent?: boolean) => boolean;
  get: (key: string, persistent?: boolean) => any;
  remove: (key: string, persistent?: boolean) => void;
  clear: () => void;
}

export interface PPLib {
  version: string;
  _isReady: boolean;
  config: PPLibConfig;
  SafeUtils: SafeUtils;
  Security: Security;
  Storage: Storage;
  getCookie: (name: string) => string | null;
  deleteCookie: (name: string) => void;
  getQueryParam: (url: string, findParam: string) => string;
  log: (level: string, message: string, data?: any) => void;
  extend: (target: any, source: any) => any;
  ready: (callback: (ppLib: PPLib) => void) => void;
  attribution: import('../common/attribution').AttributionService;
  login?: import('./login.types').LoginAPI;
  ecommerce?: import('./ecommerce.types').EcommerceAPI;
  eventSource?: import('./event-source.types').EventSourceAPI;
  mixpanel?: import('./mixpanel.types').MixpanelAPI;
  braze?: import('./braze.types').BrazeAPI;
  voucherify?: import('./voucherify.types').VoucherifyAPI;
  datalayer?: import('./datalayer.types').DataLayerAPI;
  vwo?: import('./vwo.types').VWOAPI;
  // Session management
  session?: import('../common/session').SessionService;
  // DataLayer enricher system
  registerEnricher?: (enricherFn: (pushFn: (...args: any[]) => number) => (...args: any[]) => number) => void;
  _enrichers?: Array<(pushFn: (...args: any[]) => number) => (...args: any[]) => number>;
  // Shared event-properties builder (consumed by datalayer enricher and mixpanel.track wrapper)
  eventPropertiesBuilder?: import('../common/event-properties-builder').EventPropertiesBuilder;
  // Internal bound flags (prevent double-binding across script reloads)
  _ecomBound?: boolean;
  _esBound?: boolean;
  _mpTrackPatched?: boolean;
  _firedEvents?: Record<string, boolean>;
  _vwoExperimentProps?: Record<string, string>;
}
