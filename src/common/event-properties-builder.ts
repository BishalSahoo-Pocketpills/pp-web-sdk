/**
 * Event Properties Builder
 *
 * Shared property builder used by:
 *  - the dataLayer enricher (`src/datalayer/enrichers/event-properties.ts`)
 *  - the mixpanel.track wrapper (`src/mixpanel/index.ts`)
 *
 * Produces the canonical per-event property shape so every event sent to
 * GTM and Mixpanel carries the same context (UTM touch attribution,
 * device/session/login state, page, click IDs, marketing attribution).
 *
 * Stable per-session fields (browser, device_type, country, device_id) are
 * memoized; volatile fields (URL, referrer, login state, attribution) are
 * recomputed on each build() call.
 */
import type { PPLib } from '@src/types/common.types';

export interface EventPropertiesBuilderCookieNames {
  userId: string;
  patientId: string;
  appAuth: string;
  country: string;
}

export interface EventPropertiesBuilderOpts {
  cookieNames?: Partial<EventPropertiesBuilderCookieNames>;
  defaultPlatform?: string;
}

export interface BuiltUserProperties {
  userId: string;
  patientId: string;
  pp_distinct_id: string;
}

export interface BuiltEventProperties {
  current_url: string;
  url: string;
  device_id: string;
  pp_user_id: string;
  pp_patient_id: string;
  pp_session_id: string;
  pp_timestamp: number;
  platform: string;
  is_logged_in: boolean;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  country: string;
  browser: string;
  device_type: string;
  referrer: string;
  initial_referrer: string;
  marketing_attribution: unknown;
  [bracketKey: string]: unknown;
}

export interface BuiltPage {
  url: string;
  title: string;
  referrer: string;
}

export interface BuiltAttribution {
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ttclid: string | null;
  epik: string | null;
  rdt_cid: string | null;
}

export interface BuiltEventBundle {
  userProperties: BuiltUserProperties;
  eventProperties: BuiltEventProperties;
  page: BuiltPage;
  attribution: BuiltAttribution;
}

export interface EventPropertiesBuilder {
  configure: (next: EventPropertiesBuilderOpts) => void;
  build: () => BuiltEventBundle;
  buildFlat: () => Record<string, unknown>;
}

var DEVICE_ID_KEY = 'pp_device_id';

// Properties already registered as Mixpanel super-properties elsewhere in the
// SDK. Skipping them in buildFlat() avoids redundant per-event payload bloat.
var MIXPANEL_SUPER_PROP_KEYS: Record<string, true> = {
  'marketing_attribution': true,
  'utm_source [first touch]': true,
  'utm_medium [first touch]': true,
  'utm_campaign [first touch]': true,
  'utm_source [last touch]': true,
  'utm_medium [last touch]': true,
  'utm_campaign [last touch]': true
};

function defaultCookieNames(): EventPropertiesBuilderCookieNames {
  return {
    userId: 'userId',
    patientId: 'patientId',
    appAuth: 'app_is_authenticated',
    country: 'country'
  };
}

export function createEventPropertiesBuilder(
  win: Window & typeof globalThis,
  ppLib: PPLib
): EventPropertiesBuilder {

  var cookieNames: EventPropertiesBuilderCookieNames = defaultCookieNames();
  var defaultPlatform: string = 'web';

  // Stable per-session fields — derived once, reset on configure().
  var stableCache: { browser: string; device_type: string; country: string; device_id: string } | null = null;

  function configure(next: EventPropertiesBuilderOpts): void {
    if (next.cookieNames) {
      var prev = cookieNames;
      cookieNames = {
        userId: next.cookieNames.userId || prev.userId,
        patientId: next.cookieNames.patientId || prev.patientId,
        appAuth: next.cookieNames.appAuth || prev.appAuth,
        country: next.cookieNames.country || prev.country
      };
    }
    if (typeof next.defaultPlatform === 'string') {
      defaultPlatform = next.defaultPlatform;
    }
    stableCache = null; // invalidate — country cookie name may have changed
  }

  function getOrCreateDeviceId(): string {
    try {
      var stored = win.localStorage.getItem(DEVICE_ID_KEY);
      if (stored) return stored;

      var id: string;
      try {
        if (typeof win.crypto !== 'undefined' && typeof win.crypto.randomUUID === 'function') {
          id = win.crypto.randomUUID();
        } else {
          id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
        }
      } catch (e) {
        id = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 11);
      }

      win.localStorage.setItem(DEVICE_ID_KEY, id);
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

  // The SDK emits `country` as an ISO-2 code (e.g. "CA") for cross-tool
  // joins (Mixpanel, Braze, GA, BigQuery exports). This is INTENTIONALLY
  // distinct from the geo-derived properties Mixpanel auto-attaches to
  // every event from server-side IP lookup — those appear in the raw
  // payload as `mp_country_code` ("CA") and are shown in Mixpanel's UI
  // with the full-name label "Country: Canada". The two coexist by design;
  // analysts querying our SDK should use lowercase `country`.
  //
  // Best-effort fallback when the SDK cookie is missing: parse
  // navigator.language (e.g. "en-CA" → "CA"). Browsers without a region
  // give "en" and we return "". This mirrors browser locale, not IP
  // geolocation, so it can disagree with mp_country_code on VPN'd users.
  function countryFromLocale(): string {
    try {
      var lang = (win.navigator && win.navigator.language) || '';
      var dash = lang.indexOf('-');
      if (dash === -1) return '';
      return lang.substring(dash + 1).toUpperCase();
    } catch (e) {
      return '';
    }
  }

  function buildStable() {
    if (stableCache) return stableCache;
    var ua = (win.navigator && win.navigator.userAgent) || '';
    stableCache = {
      browser: parseBrowser(ua),
      device_type: parseDeviceType(ua),
      country: ppLib.getCookie(cookieNames.country) || countryFromLocale(),
      device_id: getOrCreateDeviceId()
    };
    return stableCache;
  }

  function build(): BuiltEventBundle {
    var stable = buildStable();
    var userId = ppLib.getCookie(cookieNames.userId) || '';
    var patientId = ppLib.getCookie(cookieNames.patientId) || '';
    var appAuth = ppLib.getCookie(cookieNames.appAuth) || '';
    var isLoggedIn = appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId);

    var current = ppLib.attribution ? ppLib.attribution.getCurrent() : null;
    var firstTouch = ppLib.attribution ? ppLib.attribution.getFirstTouch() : null;
    var lastTouch = ppLib.attribution ? ppLib.attribution.getLastTouch() : null;

    var userProperties: BuiltUserProperties = {
      userId: userId,
      patientId: patientId,
      pp_distinct_id: isLoggedIn ? userId : stable.device_id
    };

    var eventProperties: BuiltEventProperties = {
      current_url: win.location.href,
      url: win.location.pathname || '/',
      device_id: stable.device_id,
      pp_user_id: userId,
      pp_patient_id: patientId,
      pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
      pp_timestamp: Date.now(),
      platform: defaultPlatform,
      is_logged_in: isLoggedIn,

      // Current UTM (from URL) — Mixpanel-style $direct/none fallbacks for
      // consistency with [first touch] / [last touch] keys.
      utm_source: current && current.source ? current.source : '$direct',
      utm_medium: current && current.medium ? current.medium : 'none',
      utm_campaign: current && current.campaign ? current.campaign : 'none',

      // First touch UTM (Mixpanel-style bracket keys with $direct/none fallbacks)
      'utm_source [first touch]': firstTouch && firstTouch.source ? firstTouch.source : '$direct',
      'utm_medium [first touch]': firstTouch && firstTouch.medium ? firstTouch.medium : 'none',
      'utm_campaign [first touch]': firstTouch && firstTouch.campaign ? firstTouch.campaign : 'none',

      // Last touch UTM (Mixpanel-style bracket keys with $direct/none fallbacks)
      'utm_source [last touch]': lastTouch && lastTouch.source ? lastTouch.source : '$direct',
      'utm_medium [last touch]': lastTouch && lastTouch.medium ? lastTouch.medium : 'none',
      'utm_campaign [last touch]': lastTouch && lastTouch.campaign ? lastTouch.campaign : 'none',

      // User context
      country: stable.country,
      browser: stable.browser,
      device_type: stable.device_type,
      referrer: extractDomain(win.document.referrer),
      initial_referrer: firstTouch ? firstTouch.referrer : '',

      // Marketing attribution
      marketing_attribution: ppLib.attribution ? ppLib.attribution.get() : null
    };

    var page: BuiltPage = {
      url: win.location.pathname || '/',
      title: win.document.title || '',
      referrer: win.document.referrer || ''
    };

    var params = new URLSearchParams(win.location.search || '');
    var attribution: BuiltAttribution = {
      fbclid: params.get('fbclid') || null,
      fbc: ppLib.getCookie('_fbc') || null,
      fbp: ppLib.getCookie('_fbp') || null,
      gclid: params.get('gclid') || null,
      gbraid: params.get('gbraid') || null,
      wbraid: params.get('wbraid') || null,
      ttclid: params.get('ttclid') || null,
      epik: params.get('epik') || null,
      rdt_cid: params.get('rdt_cid') || null
    };

    return { userProperties: userProperties, eventProperties: eventProperties, page: page, attribution: attribution };
  }

  function buildFlat(): Record<string, unknown> {
    var bundle = build();
    var flat: Record<string, unknown> = {};

    // userProperties first, then eventProperties — eventProperties wins on
    // overlapping keys (none today, but safe ordering for future fields).
    var userObj = bundle.userProperties as unknown as Record<string, unknown>;
    var userKeys = Object.keys(userObj);
    for (var i = 0; i < userKeys.length; i++) {
      flat[userKeys[i]] = userObj[userKeys[i]];
    }
    var eventObj = bundle.eventProperties as unknown as Record<string, unknown>;
    var eventKeys = Object.keys(eventObj);
    for (var j = 0; j < eventKeys.length; j++) {
      var k = eventKeys[j];
      if (MIXPANEL_SUPER_PROP_KEYS[k]) continue; // skip super-prop duplication
      flat[k] = eventObj[k];
    }

    // Ad-platform click IDs — useful per-event for downstream conversion attribution.
    var attrObj = bundle.attribution as unknown as Record<string, unknown>;
    var attrKeys = Object.keys(attrObj);
    for (var n = 0; n < attrKeys.length; n++) {
      var ak = attrKeys[n];
      var av = attrObj[ak];
      if (av !== null && av !== undefined) flat[ak] = av;
    }

    return flat;
  }

  return { configure: configure, build: build, buildFlat: buildFlat };
}
