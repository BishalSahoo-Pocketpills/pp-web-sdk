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
import { stripEmptyProps } from '@src/common/event-properties-builder';

type PushFn = (...args: unknown[]) => number;

// Minimal shape we treat as an "event" — anything pushed onto the dataLayer
// with an `event` field. Other arg shapes (e.g. `{ ecommerce: null }`) flow
// through unmodified.
interface DataLayerEventShape {
  event: string;
  userProperties?: unknown;
  eventProperties?: unknown;
  page?: unknown;
  attribution?: unknown;
  [key: string]: unknown;
}

function isEventShape(value: unknown): value is DataLayerEventShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { event?: unknown }).event === 'string'
  );
}

export function createEventPropertiesEnricher(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: DataLayerConfig
): (pushFn: PushFn) => PushFn {

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

  return function withEventProperties(pushFn: PushFn): PushFn {
    return function(...args: unknown[]): number {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (isEventShape(arg)) {
          const builder = ppLib.eventPropertiesBuilder;
          /*! v8 ignore start */
          if (!builder) continue;
          /*! v8 ignore stop */

          const bundle = builder.build();
          // 3E: strip null/undefined/'' so dataLayer mirrors Mixpanel's
          // behavior. Opt out via `preserveEmptyProperties: true`.
          if (CONFIG.preserveEmptyProperties) {
            arg.userProperties = bundle.userProperties;
            arg.eventProperties = bundle.eventProperties;
            arg.page = bundle.page;
            arg.attribution = bundle.attribution;
          } else {
            arg.userProperties = stripEmptyProps(bundle.userProperties as unknown as Record<string, unknown>);
            arg.eventProperties = stripEmptyProps(bundle.eventProperties as unknown as Record<string, unknown>);
            arg.page = stripEmptyProps(bundle.page as unknown as Record<string, unknown>);
            arg.attribution = stripEmptyProps(bundle.attribution as unknown as Record<string, unknown>);
          }
        }
      }
      return pushFn.apply(null, args);
    };
  };
}
