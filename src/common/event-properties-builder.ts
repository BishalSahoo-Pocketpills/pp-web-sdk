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

export type RawUtmTouch = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
};

export interface EventPropertiesBuilder {
  configure: (next: EventPropertiesBuilderOpts) => void;
  build: () => BuiltEventBundle;
  buildFlat: () => Record<string, unknown>;
  /** Literal utm_* params from the current visit's URL (no normalization). */
  getCurrentUtm: () => RawUtmTouch;
  /** Persisted first-touch utm_* — only set on the first visit that had utm_* params. */
  getFirstTouchUtm: () => RawUtmTouch;
  /** Persisted last-touch utm_* — overwritten on every visit that has utm_* params. */
  getLastTouchUtm: () => RawUtmTouch;
}

const DEVICE_ID_KEY = 'pp_device_id';
const UTM_FIRST_TOUCH_KEY = 'pp_utm_first_touch';
const UTM_LAST_TOUCH_KEY = 'pp_utm_last_touch';
const UTM_KEYS: ReadonlyArray<keyof RawUtmTouch> = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function emptyUtm(): RawUtmTouch {
  return { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };
}

// Properties already registered as Mixpanel super-properties elsewhere in the
// SDK. Skipping them in buildFlat() avoids redundant per-event payload bloat.
const MIXPANEL_SUPER_PROP_KEYS: Record<string, true> = {
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

  let cookieNames: EventPropertiesBuilderCookieNames = defaultCookieNames();
  let defaultPlatform: string = 'web';

  // Stable per-session fields — derived once, reset on configure().
  let stableCache: { browser: string; device_type: string; country: string; device_id: string } | null = null;

  function configure(next: EventPropertiesBuilderOpts): void {
    if (next.cookieNames) {
      const prev = cookieNames;
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
      const stored = win.localStorage.getItem(DEVICE_ID_KEY);
      if (stored) return stored;

      let id: string;
      try {
        if (typeof win.crypto !== 'undefined' && typeof win.crypto.randomUUID === 'function') {
          id = win.crypto.randomUUID();
        } else {
          id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
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
    const lower = ua.toLowerCase();
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
  // Source: cookie only. We deliberately do NOT fall back to
  // navigator.language — it reflects the browser's UI language (often
  // "en-US" by default on Chrome regardless of physical location) and
  // produces confidently-wrong values. When the cookie is empty we leave
  // `country` empty rather than ship fake data; analysts can rely on
  // Mixpanel's IP-based `mp_country_code` for those events. The cookie
  // should be set server-side from real IP geolocation (e.g. via the
  // CF-IPCountry header at the edge).

  // ---------------------------------------------------------------------------
  // Raw UTM tracking — `utm_*` keys are LITERAL URL params, intentionally
  // separate from the attribution service's normalized source/medium/campaign
  // (which fold in aliases like `source=`, `gclid=`, etc. into
  // marketingAttribution). Conflating the two muddies analytics: a visit with
  // `?source=febpt` should leave `utm_source` empty (`$direct`) while
  // `marketingAttribution.source` correctly reports "febpt".
  // ---------------------------------------------------------------------------

  function readUtmFromUrl(): RawUtmTouch {
    const result = emptyUtm();
    try {
      // Prefer document.URL — matches the rest of the SDK's URL access and
      // honors the test pattern of stubbing document.URL via defineProperty.
      const url = (win.document && win.document.URL) || win.location.href || '';
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const k = UTM_KEYS[i];
        result[k] = ppLib.getQueryParam(url, k) || '';
      }
    } catch (e) {
      /* keep empty result on any failure */
    }
    return result;
  }

  function readStoredUtm(storageKey: string): RawUtmTouch {
    try {
      const raw = win.localStorage.getItem(storageKey);
      if (!raw) return emptyUtm();
      const parsed = ppLib.Security && ppLib.Security.json
        ? ppLib.Security.json.parse(raw, null)
        : JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyUtm();
      const out = emptyUtm();
      for (let i = 0; i < UTM_KEYS.length; i++) {
        const k = UTM_KEYS[i];
        const v = (parsed as Record<string, unknown>)[k];
        out[k] = typeof v === 'string' ? v : '';
      }
      return out;
    } catch (e) {
      return emptyUtm();
    }
  }

  function persistUtm(storageKey: string, value: RawUtmTouch): void {
    try {
      win.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (e) {
      /* localStorage may be disabled — leave persistence as best-effort */
    }
  }

  // Capture the current visit's utm_* into last-touch (always overwritten when
  // present) and first-touch (set once, locked thereafter). Skipped on visits
  // with no utm_* params so a direct return doesn't clobber stored attribution.
  let utmCaptured = false;
  function captureUtmTouches(): void {
    if (utmCaptured) return;
    utmCaptured = true;
    const current = readUtmFromUrl();
    let hasAny = false;
    for (let i = 0; i < UTM_KEYS.length; i++) {
      if (current[UTM_KEYS[i]]) { hasAny = true; break; }
    }
    if (!hasAny) return;
    persistUtm(UTM_LAST_TOUCH_KEY, current);
    const existingFirst = readStoredUtm(UTM_FIRST_TOUCH_KEY);
    let firstAlreadySet = false;
    for (let j = 0; j < UTM_KEYS.length; j++) {
      if (existingFirst[UTM_KEYS[j]]) { firstAlreadySet = true; break; }
    }
    if (!firstAlreadySet) persistUtm(UTM_FIRST_TOUCH_KEY, current);
  }

  // Each getter triggers captureUtmTouches() so the persistence runs on the
  // first call regardless of whether build() was invoked first. Capture is
  // idempotent (guarded by utmCaptured), so this stays a one-time cost per
  // builder instance.
  function getCurrentUtm(): RawUtmTouch {
    captureUtmTouches();
    return readUtmFromUrl();
  }
  function getFirstTouchUtm(): RawUtmTouch {
    captureUtmTouches();
    return readStoredUtm(UTM_FIRST_TOUCH_KEY);
  }
  function getLastTouchUtm(): RawUtmTouch {
    captureUtmTouches();
    return readStoredUtm(UTM_LAST_TOUCH_KEY);
  }

  function utmFallback(key: keyof RawUtmTouch): string {
    return key === 'utm_source' ? '$direct' : 'none';
  }
  function utmOrFallback(touch: RawUtmTouch, key: keyof RawUtmTouch): string {
    return touch[key] || utmFallback(key);
  }

  function buildStable() {
    if (stableCache) return stableCache;
    const ua = (win.navigator && win.navigator.userAgent) || '';
    stableCache = {
      browser: parseBrowser(ua),
      device_type: parseDeviceType(ua),
      country: ppLib.getCookie(cookieNames.country) || '',
      device_id: getOrCreateDeviceId()
    };
    return stableCache;
  }

  function build(): BuiltEventBundle {
    const stable = buildStable();
    captureUtmTouches();

    const userId = ppLib.getCookie(cookieNames.userId) || '';
    const patientId = ppLib.getCookie(cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(cookieNames.appAuth) || '';
    const isLoggedIn = appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId);

    // Literal utm_* params — intentionally NOT routed through the attribution
    // service's normalization, so e.g. `?source=febpt` does NOT populate
    // utm_source. The attribution service still normalizes for
    // marketing_attribution below.
    const currentUtm = readUtmFromUrl();
    const firstUtm = readStoredUtm(UTM_FIRST_TOUCH_KEY);
    const lastUtm = readStoredUtm(UTM_LAST_TOUCH_KEY);

    const firstTouchAttr = ppLib.attribution ? ppLib.attribution.getFirstTouch() : null;

    const userProperties: BuiltUserProperties = {
      userId: userId,
      patientId: patientId,
      pp_distinct_id: isLoggedIn ? userId : stable.device_id
    };

    const eventProperties: BuiltEventProperties = {
      current_url: win.location.href,
      url: win.location.pathname || '/',
      device_id: stable.device_id,
      pp_user_id: userId,
      pp_patient_id: patientId,
      pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
      pp_timestamp: Date.now(),
      platform: defaultPlatform,
      is_logged_in: isLoggedIn,

      // Current UTM — literal URL params with Mixpanel-style $direct/none
      // fallbacks for consistency with [first touch] / [last touch] keys.
      utm_source: utmOrFallback(currentUtm, 'utm_source'),
      utm_medium: utmOrFallback(currentUtm, 'utm_medium'),
      utm_campaign: utmOrFallback(currentUtm, 'utm_campaign'),

      // First touch UTM — locked once on the first visit that had utm_* params.
      'utm_source [first touch]': utmOrFallback(firstUtm, 'utm_source'),
      'utm_medium [first touch]': utmOrFallback(firstUtm, 'utm_medium'),
      'utm_campaign [first touch]': utmOrFallback(firstUtm, 'utm_campaign'),

      // Last touch UTM — overwritten on every visit with utm_* params.
      'utm_source [last touch]': utmOrFallback(lastUtm, 'utm_source'),
      'utm_medium [last touch]': utmOrFallback(lastUtm, 'utm_medium'),
      'utm_campaign [last touch]': utmOrFallback(lastUtm, 'utm_campaign'),

      // User context
      country: stable.country,
      browser: stable.browser,
      device_type: stable.device_type,
      referrer: extractDomain(win.document.referrer),
      // initial_referrer still comes from the attribution service's first-touch
      // (referrer is not a UTM concept).
      initial_referrer: firstTouchAttr ? firstTouchAttr.referrer : '',

      // Marketing attribution — the normalized view (handles source=, gclid, …).
      marketing_attribution: ppLib.attribution ? ppLib.attribution.get() : null
    };

    const page: BuiltPage = {
      url: win.location.pathname || '/',
      title: win.document.title || '',
      referrer: win.document.referrer || ''
    };

    const params = new URLSearchParams(win.location.search || '');
    const attribution: BuiltAttribution = {
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
    const bundle = build();
    const flat: Record<string, unknown> = {};

    // userProperties first, then eventProperties — eventProperties wins on
    // overlapping keys (none today, but safe ordering for future fields).
    const userObj = bundle.userProperties as unknown as Record<string, unknown>;
    const userKeys = Object.keys(userObj);
    for (let i = 0; i < userKeys.length; i++) {
      flat[userKeys[i]] = userObj[userKeys[i]];
    }
    const eventObj = bundle.eventProperties as unknown as Record<string, unknown>;
    const eventKeys = Object.keys(eventObj);
    for (let j = 0; j < eventKeys.length; j++) {
      const k = eventKeys[j];
      if (MIXPANEL_SUPER_PROP_KEYS[k]) continue; // skip super-prop duplication
      flat[k] = eventObj[k];
    }

    // Ad-platform click IDs — useful per-event for downstream conversion attribution.
    const attrObj = bundle.attribution as unknown as Record<string, unknown>;
    const attrKeys = Object.keys(attrObj);
    for (let n = 0; n < attrKeys.length; n++) {
      const ak = attrKeys[n];
      const av = attrObj[ak];
      if (av !== null && av !== undefined) flat[ak] = av;
    }

    return flat;
  }

  return {
    configure: configure,
    build: build,
    buildFlat: buildFlat,
    getCurrentUtm: getCurrentUtm,
    getFirstTouchUtm: getFirstTouchUtm,
    getLastTouchUtm: getLastTouchUtm
  };
}
