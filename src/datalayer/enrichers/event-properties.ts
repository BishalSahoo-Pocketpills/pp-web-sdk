/**
 * Event Properties Enricher
 *
 * Adds eventProperties and page blocks to every dataLayer event.
 * Reads cookies, session, attribution, and UA at push time (not registration
 * time) so values are always fresh.
 */
import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig } from '@src/types/datalayer.types';

var DEVICE_ID_KEY = 'pp_device_id';

function getOrCreateDeviceId(): string {
  try {
    var stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    var id: string;
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
      } else {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      }
    } catch (e) {
      id = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 11);
    }

    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch (e) {
    return '';
  }
}

function parseBrowser(ua: string): string {
  if (!ua) return '';
  if (ua.indexOf('Edg/') !== -1) return 'Edge';
  if (ua.indexOf('OPR/') !== -1 || ua.indexOf('Opera') !== -1) return 'Opera';
  if (ua.indexOf('Chrome/') !== -1) return 'Chrome';
  if (ua.indexOf('Safari/') !== -1 && ua.indexOf('Chrome') === -1) return 'Safari';
  if (ua.indexOf('Firefox/') !== -1) return 'Firefox';
  if (ua.indexOf('MSIE') !== -1 || ua.indexOf('Trident/') !== -1) return 'IE';
  return '';
}

function parseDeviceType(ua: string): string {
  if (!ua) return '';
  var lower = ua.toLowerCase();
  if (lower.indexOf('ipad') !== -1) return 'tablet';
  if (lower.indexOf('tablet') !== -1 || lower.indexOf('kindle') !== -1) return 'tablet';
  if (lower.indexOf('mobi') !== -1 || lower.indexOf('android') !== -1 && lower.indexOf('mobile') !== -1) return 'mobile';
  if (lower.indexOf('android') !== -1) return 'tablet';
  return 'desktop';
}

function extractDomain(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

export function createEventPropertiesEnricher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig
): (pushFn: (...args: any[]) => number) => (...args: any[]) => number {

  return function withEventProperties(pushFn: (...args: any[]) => number) {
    return function() {
      var args = Array.prototype.slice.call(arguments) as any[];
      for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg && typeof arg === 'object' && arg.event) {
          var ua = win.navigator.userAgent || '';
          var userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
          var patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
          var appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';
          var isLoggedIn = appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId);
          var deviceId = getOrCreateDeviceId();

          // Attribution data (current, first touch, last touch)
          var current = ppLib.attribution ? ppLib.attribution.getCurrent() : null;
          var firstTouch = ppLib.attribution ? ppLib.attribution.getFirstTouch() : null;
          var lastTouch = ppLib.attribution ? ppLib.attribution.getLastTouch() : null;

          arg.userProperties = {
            userId: userId,
            patientId: patientId,
            pp_distinct_id: isLoggedIn ? userId : deviceId
          };

          arg.eventProperties = {
            current_url: win.location.href,
            url: win.location.pathname || '/',
            device_id: deviceId,
            pp_user_id: userId,
            pp_patient_id: patientId,
            pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
            pp_timestamp: Date.now(),
            platform: CONFIG.defaults.platform,
            is_logged_in: isLoggedIn,

            // Current UTM
            utm_source: current ? current.source : '',
            utm_medium: current ? current.medium : '',
            utm_campaign: current ? current.campaign : '',

            // First touch UTM
            utm_source_first_touch: firstTouch ? firstTouch.source : '',
            utm_medium_first_touch: firstTouch ? firstTouch.medium : '',
            utm_campaign_first_touch: firstTouch ? firstTouch.campaign : '',

            // Last touch UTM
            utm_source_last_touch: lastTouch ? lastTouch.source : '',
            utm_medium_last_touch: lastTouch ? lastTouch.medium : '',
            utm_campaign_last_touch: lastTouch ? lastTouch.campaign : '',

            // User context
            country: ppLib.getCookie(CONFIG.cookieNames.country) || '',
            browser: parseBrowser(ua),
            device_type: parseDeviceType(ua),
            referrer: extractDomain(win.document.referrer),
            initial_referrer: firstTouch ? firstTouch.referrer : ''
          };

          arg.page = {
            url: win.location.pathname || '/',
            title: win.document.title || '',
            referrer: win.document.referrer || ''
          };
        }
      }
      return pushFn.apply(null, args);
    };
  };
}
