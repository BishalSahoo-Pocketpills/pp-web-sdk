import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';

export interface AnalyticsConsent {
  state: string;
  isGranted: () => boolean;
  isRequired: () => boolean;
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

  const api: AnalyticsConsent = {
    state: SafeUtils.get(CONFIG, 'consent.defaultState', 'approved') as string,

    // No result cache (F19): every check reflects the CURRENT framework /
    // storage state. The underlying reads (array indexOf, cookie parse,
    // localStorage read) are cheap, whereas a stale cache would let tracking
    // continue for up to a minute after an external CMP revoke that mutates
    // OneTrust groups / the CookieYes cookie directly (without calling
    // setConsent), which is exactly the gap this gate exists to close.
    isGranted: function(): boolean {
      try {
        if (!SafeUtils.get(CONFIG, 'consent.required', false)) {
          return true;
        }

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

        return result;
      } catch (e) {
        utils.log('error', 'Consent check error', e);
        return api.state === 'approved';
      }
    },

    // Whether this module's consent gate is armed. When false (the shipped
    // default), isGranted() short-circuits to true regardless of the persisted
    // choice, so the unified common-consent service treats this delegate as
    // having no authoritative opinion and lets an explicit revoke() win.
    isRequired: function(): boolean {
      return SafeUtils.get(CONFIG, 'consent.required', false) === true;
    },

    checkOneTrust: function(): boolean {
      try {
        const groups = win.OnetrustActiveGroups;
        if (SafeUtils.exists(groups)) {
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

        if (SafeUtils.exists(cookie)) {
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

        if (SafeUtils.exists(stored)) {
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
