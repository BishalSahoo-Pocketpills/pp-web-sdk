import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';

export function createAnalyticsConfig(ppLib: PPLib): AnalyticsConfig {
  return {
    version: '3.1.0',
    /*! v8 ignore start */
    namespace: ppLib.config.namespace || 'pp_attr',
    /*! v8 ignore stop */

    consent: {
      required: false,
      defaultState: 'approved',
      storageKey: 'pp_consent',
      frameworks: {
        oneTrust: { enabled: false, cookieName: 'OptanonConsent', categoryId: 'C0002' },
        cookieYes: { enabled: false, cookieName: 'cookieyes-consent', categoryId: 'analytics' },
        custom: { enabled: false, checkFunction: function() { return true; } }
      }
    },

    parameters: {
      utm: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
      ads: {
        google: ['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid'],
        facebook: ['fbclid', 'fb_action_ids'],
        microsoft: ['msclkid'],
        tiktok: ['ttclid'],
        linkedin: ['li_fat_id'],
        twitter: ['twclid'],
        pinterest: ['epik'],
        snapchat: ['ScCid']
      },
      custom: ['ref', 'referrer', 'promo', 'affiliate_id']
    },

    attribution: {
      sessionTimeout: 30,
      enableFirstTouch: true,
      enableLastTouch: true,
      persistAcrossSessions: false,
      trackPageViews: true,
      autoCapture: true
    },

    platforms: {
      gtm: {
        enabled: true,
        events: {
          firstTouch: 'first_touch_attribution',
          lastTouch: 'last_touch_attribution',
          pageView: 'page_view'
        },
        rateLimitMax: 100,
        rateLimitWindow: 60000
      },
      ga4: { enabled: true, measurementId: null, sendPageView: true },
      mixpanel: { enabled: true, trackPageView: true, maxRetries: 50, retryInterval: 100 },
      custom: []
    },

    performance: {
      useRequestIdleCallback: true,
      queueEnabled: true,
      maxQueueSize: 50,
      drainBatchSize: 25
    },

    /*! v8 ignore start */
    debug: ppLib.config.debug || false,
    verbose: ppLib.config.verbose || false
    /*! v8 ignore stop */
  };
}
