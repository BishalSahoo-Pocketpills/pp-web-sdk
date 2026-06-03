import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig, AttributionData, TrackedParams, CustomPlatform } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';
import type { AnalyticsConsent } from '@src/analytics/consent';
import type { UrlParser } from '@src/analytics/url-parser';
import type { AnalyticsSession } from '@src/analytics/session';
import type { AnalyticsEventQueue } from '@src/analytics/event-queue';

export interface AnalyticsTracker {
  initialized: boolean;
  init: () => void;
  sendAttribution: () => void;
  trackPageView: () => void;
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  getAttribution: () => AttributionData;
}

export interface TrackerDeps {
  consent: AnalyticsConsent;
  urlParser: UrlParser;
  session: AnalyticsSession;
  eventQueue: AnalyticsEventQueue;
}

export function createTracker(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: AnalyticsConfig,
  utils: AnalyticsUtils,
  deps: TrackerDeps
): AnalyticsTracker {
  const SafeUtils = ppLib.SafeUtils;
  const Storage = ppLib.Storage;
  const { consent, urlParser, session, eventQueue } = deps;

  const tracker: AnalyticsTracker = {
    initialized: false,
    init: init,
    sendAttribution: sendAttribution,
    trackPageView: trackPageView,
    track: track,
    getAttribution: getAttribution
  };

  function init(): void {
    try {
      /*! v8 ignore start */
      if (!consent.isGranted()) {
      /*! v8 ignore stop */
        utils.log('info', 'Consent not granted, skipping tracking');
        return;
      }

      utils.log('info', 'Initializing tracker v' + CONFIG.version);

      // Marketing attribution capture lives inside the shared
      // event-properties builder (via captureUtmTouches). The builder is
      // created by the common module and runs on first build() /
      // getMarketingAttribution call, so no explicit init() is needed
      // here. The attribution.* config keys below (autoCapture,
      // enableFirstTouch, persistAcrossSessions, etc.) gate this module's
      // own first/last-touch storage in Storage.set('first_touch'), which
      // is a separate analytics-level system that predates the
      // event-properties builder.

      let currentParams: TrackedParams | null = null;

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'attribution.autoCapture', true)) {
      /*! v8 ignore stop */
        currentParams = urlParser.getTrackedParams();
      }

      /*! v8 ignore start */
      if (currentParams && Object.keys(currentParams).length > 0) {
      /*! v8 ignore stop */
        utils.log('verbose', 'Auto-captured tracking parameters', currentParams);

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'attribution.enableLastTouch', true)) {
        /*! v8 ignore stop */
          Storage.set('last_touch', currentParams);
        }

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'attribution.enableFirstTouch', true)) {
        /*! v8 ignore stop */
          const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
          const existingFirstTouch = Storage.get('first_touch', persist);
          const sessionValid = session.isValid();

          /*! v8 ignore start */
          if (!existingFirstTouch || !sessionValid) {
          /*! v8 ignore stop */
            Storage.set('first_touch', currentParams, persist);
            session.start();
            utils.log('verbose', 'Stored first-touch attribution');
          }
        }
      }

      // Gate auto-event dispatch on Mixpanel readiness so all destinations
      // (Mixpanel, dataLayer/GTM, custom platforms) see the same
      // $device_id at event time (read live from Mixpanel by the
      // event-properties builder). Synchronous Storage writes above
      // (first_touch, last_touch, session.start) already ran. The gate
      // auto-releases via 3s timeout fallback when Mixpanel is blocked
      // (see ppLib.mixpanelReady in common/index.ts).
      ppLib.mixpanelReady.then(function() {
        sendAttribution();
        if (SafeUtils.get(CONFIG, 'attribution.trackPageViews', true)) {
          trackPageView();
        }
        tracker.initialized = true;
        utils.log('info', 'Tracker initialized successfully');
      });

    } catch (e) {
      utils.log('error', 'Tracker initialization error', e);
    }
  }

  function sendAttribution(): void {
    try {
      const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
      /*! v8 ignore start */
      const firstTouch = Storage.get('first_touch', persist) || {};
      const lastTouch = Storage.get('last_touch') || {};
      /*! v8 ignore stop */

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
        if (Object.keys(firstTouch).length > 0) {
        /*! v8 ignore stop */
          eventQueue.add({
            type: 'gtm',
            data: {
              event: SafeUtils.get(CONFIG, 'platforms.gtm.events.firstTouch', 'first_touch_attribution'),
              first_touch_source: SafeUtils.get(firstTouch, 'utm_source', 'direct'),
              first_touch_medium: SafeUtils.get(firstTouch, 'utm_medium', 'none'),
              first_touch_campaign: SafeUtils.get(firstTouch, 'utm_campaign', ''),
              first_touch_term: SafeUtils.get(firstTouch, 'utm_term', ''),
              first_touch_content: SafeUtils.get(firstTouch, 'utm_content', ''),
              first_touch_gclid: SafeUtils.get(firstTouch, 'gclid', ''),
              first_touch_fbclid: SafeUtils.get(firstTouch, 'fbclid', ''),
              first_touch_landing_page: SafeUtils.get(firstTouch, 'landing_page', ''),
              first_touch_referrer: SafeUtils.get(firstTouch, 'referrer', ''),
              first_touch_timestamp: SafeUtils.get(firstTouch, 'timestamp', '')
            }
          });
        }

        /*! v8 ignore start */
        if (Object.keys(lastTouch).length > 0) {
        /*! v8 ignore stop */
          eventQueue.add({
            type: 'gtm',
            data: {
              event: SafeUtils.get(CONFIG, 'platforms.gtm.events.lastTouch', 'last_touch_attribution'),
              last_touch_source: SafeUtils.get(lastTouch, 'utm_source', 'direct'),
              last_touch_medium: SafeUtils.get(lastTouch, 'utm_medium', 'none'),
              last_touch_campaign: SafeUtils.get(lastTouch, 'utm_campaign', ''),
              last_touch_term: SafeUtils.get(lastTouch, 'utm_term', ''),
              last_touch_content: SafeUtils.get(lastTouch, 'utm_content', ''),
              last_touch_gclid: SafeUtils.get(lastTouch, 'gclid', ''),
              last_touch_fbclid: SafeUtils.get(lastTouch, 'fbclid', ''),
              last_touch_landing_page: SafeUtils.get(lastTouch, 'landing_page', ''),
              last_touch_referrer: SafeUtils.get(lastTouch, 'referrer', ''),
              last_touch_timestamp: SafeUtils.get(lastTouch, 'timestamp', '')
            }
          });
        }
      }

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
      /*! v8 ignore stop */
        const mixpanelProps: Record<string, string> = {};

        /*! v8 ignore start */
        if (Object.keys(firstTouch).length > 0) {
        /*! v8 ignore stop */
          mixpanelProps['First Touch Source'] = SafeUtils.get(firstTouch, 'utm_source', 'direct');
          mixpanelProps['First Touch Medium'] = SafeUtils.get(firstTouch, 'utm_medium', 'none');
          mixpanelProps['First Touch Campaign'] = SafeUtils.get(firstTouch, 'utm_campaign', '');
          mixpanelProps['First Touch Landing Page'] = SafeUtils.get(firstTouch, 'landing_page', '');
        }

        /*! v8 ignore start */
        if (Object.keys(lastTouch).length > 0) {
        /*! v8 ignore stop */
          mixpanelProps['Last Touch Source'] = SafeUtils.get(lastTouch, 'utm_source', 'direct');
          mixpanelProps['Last Touch Medium'] = SafeUtils.get(lastTouch, 'utm_medium', 'none');
          mixpanelProps['Last Touch Campaign'] = SafeUtils.get(lastTouch, 'utm_campaign', '');
          mixpanelProps['Last Touch Landing Page'] = SafeUtils.get(lastTouch, 'landing_page', '');
        }

        /*! v8 ignore start */
        if (Object.keys(mixpanelProps).length > 0) {
        /*! v8 ignore stop */
          eventQueue.add({
            type: 'mixpanel',
            data: {
              type: 'register',
              properties: mixpanelProps
            }
          });
        }
      }

      const customPlatforms = SafeUtils.get(CONFIG, 'platforms.custom', []);
      SafeUtils.forEach(customPlatforms, function(platform: CustomPlatform) {
        /*! v8 ignore start */
        if (platform && platform.handler) {
        /*! v8 ignore stop */
          eventQueue.add({
            type: 'custom',
            handler: platform.handler,
            data: {
              firstTouch: firstTouch,
              lastTouch: lastTouch
            }
          });
        }
      });

    } catch (e) {
      utils.log('error', 'Send attribution error', e);
    }
  }

  function trackPageView(): void {
    try {
      const data = {
        page_url: SafeUtils.get(win, 'location.href', ''),
        page_title: SafeUtils.get(doc, 'title', ''),
        page_path: SafeUtils.get(win, 'location.pathname', '')
      };

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
      /*! v8 ignore stop */
        eventQueue.add({
          type: 'gtm',
          data: ppLib.extend({
            event: SafeUtils.get(CONFIG, 'platforms.gtm.events.pageView', 'attribution_page_view')
          }, data)
        });
      }

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true) &&
          SafeUtils.get(CONFIG, 'platforms.mixpanel.trackPageView', true)) {
      /*! v8 ignore stop */
        eventQueue.add({
          type: 'mixpanel',
          data: {
            type: 'track',
            eventName: 'pageview',
            properties: data
          }
        });
      }
    } catch (e) {
      utils.log('error', 'Track page view error', e);
    }
  }

  function track(eventName: string, properties?: Record<string, unknown>): void {
    try {
      /*! v8 ignore start */
      if (!tracker.initialized) {
        utils.log('warn', 'Tracker not initialized, queuing event');
      }
      /*! v8 ignore stop */

      /*! v8 ignore start */
      if (!SafeUtils.exists(eventName)) {
      /*! v8 ignore stop */
        utils.log('error', 'Event name required');
        return;
      }

      // Consent gate (C1): suppress dispatch when consent is required and not
      // granted. With consent.required=false (default) isGranted() is true, so
      // default behavior is unchanged.
      if (!consent.isGranted()) {
        utils.log('verbose', 'Consent not granted — track() suppressed for ' + eventName);
        return;
      }

      /*! v8 ignore start */
      properties = properties || {};
      /*! v8 ignore stop */

      const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
      const firstTouch = Storage.get('first_touch', persist);
      const lastTouch = Storage.get('last_touch');

      /*! v8 ignore start */
      if (firstTouch) {
      /*! v8 ignore stop */
        properties.first_touch_source = SafeUtils.get(firstTouch, 'utm_source', 'direct');
        properties.first_touch_campaign = SafeUtils.get(firstTouch, 'utm_campaign', '');
      }

      /*! v8 ignore start */
      if (lastTouch) {
      /*! v8 ignore stop */
        properties.last_touch_source = SafeUtils.get(lastTouch, 'utm_source', 'direct');
        properties.last_touch_campaign = SafeUtils.get(lastTouch, 'utm_campaign', '');
      }

      // Clone properties to avoid mutating the caller's object
      // marketingAttribution is auto-injected by global platform patches
      const enrichedProps = ppLib.extend({}, properties);

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
      /*! v8 ignore stop */
        eventQueue.add({
          type: 'gtm',
          data: ppLib.extend({ event: eventName }, enrichedProps)
        });
      }

      /*! v8 ignore start */
      if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
      /*! v8 ignore stop */
        eventQueue.add({
          type: 'mixpanel',
          data: {
            type: 'track',
            eventName: eventName,
            properties: enrichedProps
          }
        });
      }

      utils.log('verbose', 'Tracked event: ' + eventName, properties);
    } catch (e) {
      utils.log('error', 'Track error', e);
    }
  }

  function getAttribution(): AttributionData {
    try {
      const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
      return {
        firstTouch: Storage.get<TrackedParams>('first_touch', persist) || null,
        lastTouch: Storage.get<TrackedParams>('last_touch') || null
      };
    } catch (e) {
      utils.log('error', 'Get attribution error', e);
      return { firstTouch: null, lastTouch: null };
    }
  }

  return tracker;
}
