import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';

export interface AnalyticsConsent {
  state: string;
  isGranted: () => boolean;
  checkOneTrust: () => boolean;
  checkCookieYes: () => boolean;
  getStoredConsent: () => boolean;
  setConsent: (granted: boolean) => void;
}

export interface ConsentCallbacks {
  onGranted: () => void;
  onRevoked: () => void;
}

export function createAnalyticsConsent(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: AnalyticsConfig,
  utils: AnalyticsUtils,
  callbacks: ConsentCallbacks
): AnalyticsConsent {
  const SafeUtils = ppLib.SafeUtils;
  const Security = ppLib.Security;

  /*! v8 ignore start */
  let consentCacheResult: boolean | null = null;
  let consentCacheTime: number = 0;
  const CONSENT_CACHE_TTL = 60000; // 60 seconds
  /*! v8 ignore stop */

  const api: AnalyticsConsent = {
    state: SafeUtils.get(CONFIG, 'consent.defaultState', 'approved') as string,

    isGranted: function(): boolean {
      try {
        /*! v8 ignore start */
        if (!SafeUtils.get(CONFIG, 'consent.required', false)) {
        /*! v8 ignore stop */
          return true;
        }

        const now = Date.now();
        if (consentCacheResult !== null && (now - consentCacheTime) < CONSENT_CACHE_TTL) {
          return consentCacheResult;
        }

        /*! v8 ignore start */
        let result: boolean | null = null;

        if (SafeUtils.get(CONFIG, 'consent.frameworks.custom.enabled', false)) {
          try {
            const checkFn = SafeUtils.get(CONFIG, 'consent.frameworks.custom.checkFunction');
            if (typeof checkFn === 'function') {
              result = checkFn();
            }
          } catch (e) {
            utils.log('error', 'Custom consent check failed', e);
          }
        }

        if (result === null && SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.enabled', false)) {
          if (api.checkOneTrust()) result = true;
        }

        if (result === null && SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.enabled', false)) {
          if (api.checkCookieYes()) result = true;
        }

        if (result === null) {
          result = api.getStoredConsent();
        }
        /*! v8 ignore stop */

        consentCacheResult = result;
        consentCacheTime = Date.now();
        return result;
      } catch (e) {
        /*! v8 ignore start */
        utils.log('error', 'Consent check error', e);
        consentCacheResult = api.state === 'approved';
        consentCacheTime = Date.now();
        return consentCacheResult;
        /*! v8 ignore stop */
      }
    },

    checkOneTrust: function(): boolean {
      try {
        const groups = win.OnetrustActiveGroups;
        /*! v8 ignore start */
        if (SafeUtils.exists(groups)) {
        /*! v8 ignore stop */
          const categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.categoryId', 'C0002');
          return groups.indexOf(categoryId) !== -1;
        }
      } catch (e) {
        utils.log('verbose', 'OneTrust check failed', e);
      }
      return false;
    },

    checkCookieYes: function(): boolean {
      try {
        const cookieName = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.cookieName', 'cookieyes-consent');
        const cookie = ppLib.getCookie(cookieName);

        /*! v8 ignore start */
        if (SafeUtils.exists(cookie)) {
        /*! v8 ignore stop */
          const consent = Security.json.parse(cookie as string);
          const categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.categoryId', 'analytics');
          return SafeUtils.get(consent, categoryId) === 'yes';
        }
      } catch (e) {
        utils.log('verbose', 'CookieYes check failed', e);
      }
      return false;
    },

    getStoredConsent: function(): boolean {
      try {
        const storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        const stored = win.localStorage.getItem(storageKey);

        /*! v8 ignore start */
        if (SafeUtils.exists(stored)) {
        /*! v8 ignore stop */
          // Accept both the analytics vocabulary ('approved') and the shared
          // common-consent vocabulary ('granted') so the two services agree (C2).
          const granted = stored === 'approved' || stored === 'granted';
          api.state = granted ? 'approved' : (stored as string);
          return granted;
        }
      } catch (e) {
        utils.log('verbose', 'Could not read consent from storage');
      }

      return api.state === 'approved';
    },

    setConsent: function(granted: boolean): void {
      try {
        consentCacheResult = null;
        api.state = granted ? 'approved' : 'denied';

        const storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        win.localStorage.setItem(storageKey, api.state);

        utils.log('info', 'Consent updated', { state: api.state });

        if (granted) {
          callbacks.onGranted();
        } else {
          callbacks.onRevoked();
        }
      } catch (e) {
        utils.log('error', 'Set consent error', e);
      }
    }
  };

  return api;
}
