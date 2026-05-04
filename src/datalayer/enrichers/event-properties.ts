/**
 * Event Properties Enricher
 *
 * Adds an eventProperties block to every dataLayer event:
 *   { pp_patient_id, pp_user_id, url, pp_session_id, pp_timestamp, platform }
 *
 * Reads cookies and session ID at push time (not registration time)
 * so values are always fresh.
 */
import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig } from '@src/types/datalayer.types';

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
          arg.eventProperties = {
            pp_user_id: ppLib.getCookie(CONFIG.cookieNames.userId) || '',
            pp_patient_id: ppLib.getCookie(CONFIG.cookieNames.patientId) || '',
            url: win.location.pathname || '/',
            pp_session_id: ppLib.session ? ppLib.session.getOrCreateSessionId() : '',
            pp_timestamp: Date.now(),
            platform: CONFIG.defaults.platform
          };
        }
      }
      return pushFn.apply(null, args);
    };
  };
}
