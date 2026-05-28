import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';

// Internal Mixpanel-platform queue payload — discriminator decides whether
// the upstream call goes to mixpanel.register or mixpanel.track.
export type MixpanelQueueData = {
  type: 'register' | 'track';
  eventName?: string;
  properties?: Record<string, unknown>;
};

export interface GTMPlatform {
  push: (data: Record<string, unknown>) => void;
}

export interface MixpanelPlatform {
  send: (data: MixpanelQueueData) => void;
  // Legacy debug hook retained for test cleanup compatibility (intervalId
  // from the now-removed polling loop). Always undefined in v3.5+.
  _intervalId?: number | null;
}

export interface AnalyticsPlatforms {
  GTM: GTMPlatform;
  Mixpanel: MixpanelPlatform;
  register: (name: string, handler: (data: Record<string, unknown>) => void) => void;
}

export function createPlatforms(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: AnalyticsConfig,
  utils: AnalyticsUtils
): AnalyticsPlatforms {
  const SafeUtils = ppLib.SafeUtils;
  const Security = ppLib.Security;

  const GTM: GTMPlatform = {
    push: function(data: Record<string, unknown>): void {
      try {
        /*! v8 ignore start */
        if (!data || typeof data !== 'object') return;
        /*! v8 ignore stop */

        /*! v8 ignore start */
        win.dataLayer = win.dataLayer || [];
        /*! v8 ignore stop */

        /*! v8 ignore start */
        if (!Security.validateData(data)) {
        /*! v8 ignore stop */
          utils.log('error', 'Invalid GTM data rejected');
          return;
        }

        win.dataLayer.push(data);
        utils.log('verbose', 'Pushed to GTM', data);
      } catch (e) {
        utils.log('error', 'GTM push error', e);
      }
    }
  };

  // Mixpanel dispatch — direct passthrough to the ppLib.mixpanel facade.
  //
  // Until v3.6.0 this used a local queue + checkReady polling to handle
  // load-order races (mp.init() called after analytics's auto-pageview).
  // That duplicated Mixpanel's own stub queue AND ppLib.mixpanel.trackFacade's
  // pre-init buffer, with a 5-second hard timeout that silently dropped
  // events if it expired. Now we dispatch directly: ppLib.mixpanel.track()
  // buffers internally when win.mixpanel isn't ready yet, and the buffer
  // is drained inside mp.init()'s `loaded` callback — single source of
  // truth, no polling, no timeout.
  const Mixpanel: MixpanelPlatform = {
    send: function(data: MixpanelQueueData): void {
      try {
        /*! v8 ignore start */
        if (!data || typeof data !== 'object') return;
        /*! v8 ignore stop */

        /*! v8 ignore start */
        if (!Security.validateData(data)) {
        /*! v8 ignore stop */
          utils.log('error', 'Invalid Mixpanel data rejected');
          return;
        }

        const dataType = SafeUtils.get(data, 'type', '');

        if (dataType === 'register') {
          // Route through the SDK facade. The facade fans out to BOTH
          // Mixpanel instances (primary + secondary) when dual-instance
          // is enabled, internally buffering pre-init writes. Going
          // direct to `win.mixpanel.register` would silently drop the
          // super-prop on secondary, breaking parity for any module
          // that registers via `Analytics.Mixpanel.send({ type:
          // 'register', ... })` (the same channel mixpanel-bridged
          // modules use for track).
          //
          // Fallback path mirrors the track branch below: direct
          // `win.mixpanel.register` only when the mixpanel MODULE
          // isn't loaded (minimal deployment / test fixture). Never
          // bypasses secondary because if the facade isn't loaded,
          // there's no secondary either.
          if (ppLib.mixpanel && typeof ppLib.mixpanel.register === 'function') {
            ppLib.mixpanel.register(data.properties || {});
          /*! v8 ignore start */
          } else if (win.mixpanel && typeof win.mixpanel.register === 'function') {
            win.mixpanel.register(data.properties || {});
          } else {
            utils.log('warn', 'Mixpanel.register skipped — SDK not loaded');
          }
          /*! v8 ignore stop */
        } else if (dataType === 'track') {
          // Preferred path: ppLib.mixpanel.track() handles the load-order
          // race internally (buffers when win.mixpanel.track isn't a
          // function yet, drains on the loaded callback). No checkReady,
          // no polling, no timeout.
          //
          // Route through the SDK facade. The facade fans out to BOTH
          // mixpanel instances (primary + secondary) when dual-instance
          // is enabled, internally buffering pre-init events.
          //
          // Fallback: direct win.mixpanel.track call when the mixpanel
          // MODULE isn't loaded but a Mixpanel SDK stub was installed
          // by another integration. Keeps analytics usable in test
          // fixtures and minimal deployments. Never bypasses secondary
          // because the dual-instance fan-out lives inside the facade
          // — if the facade isn't there, there's no secondary either.
          /*! v8 ignore start */
          if (ppLib.mixpanel && typeof ppLib.mixpanel.track === 'function') {
            ppLib.mixpanel.track(data.eventName || 'Unknown Event', data.properties || {});
          } else if (win.mixpanel && typeof win.mixpanel.track === 'function') {
            win.mixpanel.track(data.eventName || 'Unknown Event', data.properties || {});
          } else {
            utils.log('warn', 'Mixpanel not loaded; event dropped: ' + data.eventName);
          }
          /*! v8 ignore stop */
        }

        utils.log('verbose', 'Sent to Mixpanel', data);
      } catch (e) {
        utils.log('error', 'Mixpanel send error', e);
      }
    }
  };

  function register(name: string, handler: (data: Record<string, unknown>) => void): void {
    try {
      /*! v8 ignore start */
      if (!SafeUtils.exists(name) || typeof handler !== 'function') {
      /*! v8 ignore stop */
        utils.log('warn', 'registerPlatform requires a valid name and handler function');
        return;
      }

      /*! v8 ignore start */
      CONFIG.platforms.custom = CONFIG.platforms.custom || [];
      /*! v8 ignore stop */
      CONFIG.platforms.custom.push({ name: name, handler: handler });

      utils.log('info', 'Registered custom platform: ' + name);
    } catch (e) {
      utils.log('error', 'Register platform error', e);
    }
  }

  return {
    GTM: GTM,
    Mixpanel: Mixpanel,
    register: register
  };
}
