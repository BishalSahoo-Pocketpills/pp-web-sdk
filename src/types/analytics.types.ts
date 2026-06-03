import type { DeepPartial } from '@src/types/utility.types';

export interface ConsentFrameworkOneTrust {
  enabled: boolean;
  cookieName: string;
  categoryId: string;
}

export interface ConsentFrameworkCookieYes {
  enabled: boolean;
  cookieName: string;
  categoryId: string;
}

export interface ConsentFrameworkCustom {
  enabled: boolean;
  checkFunction: () => boolean;
}

export interface ConsentConfig {
  required: boolean;
  defaultState: string;
  storageKey: string;
  frameworks: {
    oneTrust: ConsentFrameworkOneTrust;
    cookieYes: ConsentFrameworkCookieYes;
    custom: ConsentFrameworkCustom;
  };
}

export interface AdsParameters {
  google: string[];
  facebook: string[];
  microsoft: string[];
  tiktok: string[];
  linkedin: string[];
  twitter: string[];
  pinterest: string[];
  snapchat: string[];
}

export interface ParametersConfig {
  utm: string[];
  ads: AdsParameters;
  custom: string[];
}

export interface AttributionConfig {
  sessionTimeout: number;
  enableFirstTouch: boolean;
  enableLastTouch: boolean;
  persistAcrossSessions: boolean;
  trackPageViews: boolean;
  autoCapture: boolean;
}

export interface GTMPlatformConfig {
  enabled: boolean;
  events: {
    firstTouch: string;
    lastTouch: string;
    pageView: string;
  };
  rateLimitMax: number;
  rateLimitWindow: number;
}

export interface GA4PlatformConfig {
  enabled: boolean;
  measurementId: string | null;
  sendPageView: boolean;
}

export interface MixpanelPlatformConfig {
  enabled: boolean;
  trackPageView: boolean;
  maxRetries: number;
  retryInterval: number;
}

export interface CustomPlatform {
  name: string;
  handler: (data: Record<string, unknown>) => void;
}

export interface PlatformsConfig {
  gtm: GTMPlatformConfig;
  ga4: GA4PlatformConfig;
  mixpanel: MixpanelPlatformConfig;
  custom: CustomPlatform[];
}

export interface PerformanceConfig {
  useRequestIdleCallback: boolean;
  queueEnabled: boolean;
  maxQueueSize: number;
}

export interface AnalyticsConfig {
  version: string;
  namespace: string;
  consent: ConsentConfig;
  parameters: ParametersConfig;
  attribution: AttributionConfig;
  platforms: PlatformsConfig;
  performance: PerformanceConfig;
  debug: boolean;
  verbose: boolean;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface QueueEvent {
  type: string;
  data: Record<string, unknown>;
  handler?: (data: Record<string, unknown>) => void;
}

export interface TrackedParams {
  [key: string]: string | undefined;
  landing_page?: string;
  referrer?: string;
  timestamp?: string;
}

export interface AttributionData {
  firstTouch: TrackedParams | null;
  lastTouch: TrackedParams | null;
}

export interface AnalyticsAPI {
  version: string;
  config: (options?: DeepPartial<AnalyticsConfig>) => AnalyticsConfig;
  /** Backward-compatible alias for config(). */
  configure: (options?: DeepPartial<AnalyticsConfig>) => AnalyticsConfig;
  consent: {
    grant: () => void;
    revoke: () => void;
    status: () => boolean;
  };
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  getAttribution: () => AttributionData;
  registerPlatform: (name: string, handler: (data: Record<string, unknown>) => void) => void;
  clear: () => void;
  init: () => void;
}
