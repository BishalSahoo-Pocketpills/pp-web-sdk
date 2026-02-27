import type { PPLib } from './common.types';
import type { AnalyticsAPI } from './analytics.types';

interface PPLibReadyCallback {
  (ppLib: PPLib): void;
}

declare global {
  interface Window {
    ppLib: PPLib;
    ppLibReady: PPLibReadyCallback[] | null;
    ppAnalytics: AnalyticsAPI;
    ppAnalyticsDebug: any;
    logoutUser: (hardLogout?: boolean) => void;
    dataLayer: any[];
    mixpanel: any;
    OnetrustActiveGroups: string;
    requestIdleCallback: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number) | undefined;
  }
}

export {};
