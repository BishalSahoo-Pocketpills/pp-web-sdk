/**
 * Event Properties Enricher
 *
 * Adds eventProperties / userProperties / page / attribution blocks to every
 * dataLayer event. Delegates property construction to the shared
 * `ppLib.eventPropertiesBuilder` so the same canonical shape flows to GTM
 * (via this enricher) and to Mixpanel (via the mixpanel.track wrapper).
 */
import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig } from '@src/types/datalayer.types';

export function createEventPropertiesEnricher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig
): (pushFn: (...args: any[]) => number) => (...args: any[]) => number {

  // Configure the shared builder with this module's cookie names + platform.
  // Safe to call repeatedly; the builder owns its own state.
  if (ppLib.eventPropertiesBuilder) {
    ppLib.eventPropertiesBuilder.configure({
      cookieNames: {
        userId: CONFIG.cookieNames.userId,
        patientId: CONFIG.cookieNames.patientId,
        appAuth: CONFIG.cookieNames.appAuth,
        country: CONFIG.cookieNames.country
      },
      defaultPlatform: CONFIG.defaults.platform
    });
  }

  return function withEventProperties(pushFn: (...args: any[]) => number) {
    return function() {
      var args = Array.prototype.slice.call(arguments) as any[];
      for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg && typeof arg === 'object' && arg.event) {
          var builder = ppLib.eventPropertiesBuilder;
          /*! v8 ignore start */
          if (!builder) continue;
          /*! v8 ignore stop */

          var bundle = builder.build();
          arg.userProperties = bundle.userProperties;
          arg.eventProperties = bundle.eventProperties;
          arg.page = bundle.page;
          arg.attribution = bundle.attribution;
        }
      }
      return pushFn.apply(null, args);
    };
  };
}
