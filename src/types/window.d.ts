import type { PPLib } from '@src/types/common.types';
import type { AnalyticsAPI } from '@src/types/analytics.types';

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
    braze: any;
    OnetrustActiveGroups: string;
    requestIdleCallback: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number) | undefined;
    _vwo_exp: Record<string, any>;
    _vwo_exp_ids: string[];
    _vis_opt_queue: Array<() => void>;
    _vwo_code: any;
    _vwo_settings_timer: any;
    _vis_opt_set_combination: (variationId: number, campaignId: number) => void;
    VWO: any[];
  }

  const __PP_SDK_VERSION__: string;
}

export {};
