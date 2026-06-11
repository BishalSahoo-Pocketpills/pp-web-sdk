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
      if (sessionStart === null || sessionStart === undefined || typeof sessionStart !== 'number') {
        return false;
      }

      const now = new Date().getTime();
      const sessionAge = (now - sessionStart) / 1000 / 60;

      // Enforce a sane session timeout (F7): a misconfigured 0 / negative /
      // non-number would make `sessionAge < timeout` always false, silently
      // breaking session continuity (every page would look like a new session).
      // Floor to the 30-minute default unless a positive number is configured.
      const configured = SafeUtils.get(CONFIG, 'attribution.sessionTimeout', 30);
      const timeout = typeof configured === 'number' && configured > 0 ? configured : 30;

      return sessionAge < timeout;
    } catch (e) {
      return false;
    }
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
