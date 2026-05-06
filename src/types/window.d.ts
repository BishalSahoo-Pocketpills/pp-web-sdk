import type { PPLib } from '@src/types/common.types';
import type { AnalyticsAPI } from '@src/types/analytics.types';

interface PPLibReadyCallback {
  (ppLib: PPLib): void;
}

// Third-party globals are intentionally typed loosely. We don't ship the
// vendor's own type packages and their public surfaces churn — the SDK
// type-guards every access (`if (!win.mixpanel || !win.mixpanel.track)
// return;`) before invoking. Where we use these from inside the SDK we
// cast at the use site rather than pretend to know the full shape.

// Minimal Mixpanel API surface we actually call. Keeps callers honest
// about what we depend on without claiming to model the full SDK.
interface MixpanelGlobal {
  __SV?: number;
  init: (token: string, config?: Record<string, unknown>, name?: string) => void;
  track: (event: string, properties?: Record<string, unknown>) => void;
  register: (props: Record<string, unknown>) => void;
  register_once: (props: Record<string, unknown>) => void;
  identify: (id: string) => void;
  alias: (id: string) => void;
  reset: () => void;
  opt_in_tracking: () => void;
  get_distinct_id?: () => string | null;
  get_property: (name: string) => unknown;
  people: {
    set: (props: Record<string, unknown>) => void;
    set_once: (props: Record<string, unknown>) => void;
    track_charge?: (amount: number, props?: Record<string, unknown>) => void;
  };
  // Loader-stub queue + extras the vendored snippet attaches.
  _i?: unknown[];
  [extra: string]: unknown;
}

// Braze user object as we use it. The explicit setters below are the
// standard attribute setters our SDK dispatches dynamically via
// STANDARD_ATTRS map (`user[setter](value)`). The trailing index signature
// keeps dynamic indexed access typed (returns `unknown` — caller narrows
// with `typeof user[k] === 'function'` and casts at the call site).
interface BrazeUser {
  setEmail: (email: string) => void;
  setFirstName: (val: string) => void;
  setLastName: (val: string) => void;
  setPhoneNumber: (val: string) => void;
  setGender: (val: string) => void;
  setCountry: (val: string) => void;
  setHomeCity: (val: string) => void;
  setLanguage: (val: string) => void;
  setCustomUserAttribute: (key: string, value: unknown) => void;
  [key: string]: unknown;
}

// VWO experiment record (window._vwo_exp[id]) — only the fields the SDK reads.
interface VwoExperiment {
  combination_chosen?: number | string;
  comb_n?: Record<string, string>;
  [key: string]: unknown;
}

// VWO loader/runtime global. Verbatim from the VWO snippet — methods are
// invoked dynamically; index signature keeps the surface flexible.
interface VwoCodeGlobal {
  finished_loading?: () => boolean;
  finish?: () => unknown;
  [key: string]: unknown;
}

interface BrazeGlobal {
  initialize: (apiKey: string, options?: Record<string, unknown>) => void;
  changeUser: (userId: string) => void;
  openSession: () => void;
  logCustomEvent: (event: string, properties?: Record<string, unknown>) => void;
  logPurchase: (
    productId: string,
    price: number,
    currency?: string,
    quantity?: number,
    properties?: Record<string, unknown>
  ) => void;
  requestImmediateDataFlush: () => void;
  getUser: () => BrazeUser;
  [key: string]: unknown;
}

declare global {
  interface Window {
    ppLib: PPLib;
    ppLibReady: PPLibReadyCallback[] | null;
    ppAnalytics: AnalyticsAPI;
    ppAnalyticsDebug: unknown;
    logoutUser: (hardLogout?: boolean) => void;
    dataLayer: unknown[];
    mixpanel: MixpanelGlobal;
    braze: BrazeGlobal;
    OnetrustActiveGroups: string;
    requestIdleCallback: ((callback: IdleRequestCallback, options?: IdleRequestOptions) => number) | undefined;
    _vwo_exp: Record<string, VwoExperiment>;
    _vwo_exp_ids: string[];
    _vis_opt_queue: Array<() => void>;
    _vwo_code: VwoCodeGlobal | undefined;
    _vwo_settings_timer: unknown;
    _vis_opt_set_combination: (variationId: number, campaignId: number) => void;
    VWO: unknown[];
  }

  const __PP_SDK_VERSION__: string;
}

export {};
