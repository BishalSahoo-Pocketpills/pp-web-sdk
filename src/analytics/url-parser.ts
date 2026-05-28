import type { PPLib } from '@src/types/common.types';
import type { TrackedParams } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';

export interface UrlParser {
  getParams: () => Record<string, string>;
  getTrackedParams: () => TrackedParams | null;
  getReferrer: () => string;
}

export function createUrlParser(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  utils: AnalyticsUtils
): UrlParser {
  const SafeUtils = ppLib.SafeUtils;
  const Security = ppLib.Security;

  function getParams(): Record<string, string> {
    try {
      const currentUrl = win.location && win.location.href;
      /*! v8 ignore start */
      if (!currentUrl || !Security.isValidUrl(currentUrl)) {
      /*! v8 ignore stop */
        utils.log('verbose', 'Invalid or missing URL');
        return {};
      }

      const params: Record<string, string> = {};
      /*! v8 ignore start */
      const searchParams = new URLSearchParams(win.location.search || '');
      /*! v8 ignore stop */
      const whitelist = utils.getAllParamNames();

      SafeUtils.forEach(whitelist, function(param: string) {
        try {
          const value = searchParams.get(param);
          /*! v8 ignore start */
          if (SafeUtils.exists(value)) {
          /*! v8 ignore stop */
            const sanitized = Security.sanitize(value);
            /*! v8 ignore start */
            if (SafeUtils.exists(sanitized)) {
            /*! v8 ignore stop */
              params[param] = sanitized;
            }
          }
        } catch (e) {
          utils.log('verbose', 'Param extraction error for ' + param, e);
        }
      });

      return params;
    } catch (e) {
      utils.log('error', 'URL parse error', e);
      return {};
    }
  }

  function getReferrer(): string {
    try {
      const referrer = doc.referrer;
      /*! v8 ignore start */
      if (!SafeUtils.exists(referrer)) return 'direct';
      /*! v8 ignore stop */

      const referrerUrl = new URL(referrer);
      const currentUrl = new URL(win.location.href);

      /*! v8 ignore start */
      if (referrerUrl.hostname === currentUrl.hostname) {
      /*! v8 ignore stop */
        return 'internal';
      }

      /*! v8 ignore start */
      return Security.sanitize(referrerUrl.origin) || 'unknown';
      /*! v8 ignore stop */
    } catch (e) {
      /*! v8 ignore start */
      return doc.referrer ? 'unknown' : 'direct';
      /*! v8 ignore stop */
    }
  }

  function getTrackedParams(): TrackedParams | null {
    try {
      const params = getParams() as TrackedParams;

      /*! v8 ignore start */
      if (!params || Object.keys(params).length === 0) {
      /*! v8 ignore stop */
        return null;
      }

      try {
        /*! v8 ignore start */
        params.landing_page = Security.sanitize(
          (win.location.origin || '') + (win.location.pathname || '')
        );
        /*! v8 ignore stop */
        params.referrer = getReferrer();
        params.timestamp = new Date().toISOString();
      } catch (e) {
        utils.log('verbose', 'Metadata error', e);
      }

      return params;
    } catch (e) {
      utils.log('error', 'getTrackedParams error', e);
      return null;
    }
  }

  return {
    getParams: getParams,
    getTrackedParams: getTrackedParams,
    getReferrer: getReferrer
  };
}
