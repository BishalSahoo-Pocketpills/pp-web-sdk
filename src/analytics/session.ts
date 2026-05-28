import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';

export interface AnalyticsSession {
  isValid: () => boolean;
  start: () => void;
}

export function createSession(
  ppLib: PPLib,
  CONFIG: AnalyticsConfig,
  utils: AnalyticsUtils
): AnalyticsSession {
  const SafeUtils = ppLib.SafeUtils;
  const Storage = ppLib.Storage;

  function isValid(): boolean {
    try {
      const sessionStart = Storage.get('session_start');
      /*! v8 ignore start */
      if (sessionStart === null || sessionStart === undefined || typeof sessionStart !== 'number') {
      /*! v8 ignore stop */
        return false;
      }

      const now = new Date().getTime();
      const sessionAge = (now - sessionStart) / 1000 / 60;
      const timeout = SafeUtils.get(CONFIG, 'attribution.sessionTimeout', 30);

      return sessionAge < timeout;
    /*! v8 ignore start */
    } catch (e) {
      return false;
    }
    /*! v8 ignore stop */
  }

  function start(): void {
    try {
      Storage.set('session_start', new Date().getTime());
    } catch (e) {
      utils.log('error', 'Session start error', e);
    }
  }

  return {
    isValid: isValid,
    start: start
  };
}
