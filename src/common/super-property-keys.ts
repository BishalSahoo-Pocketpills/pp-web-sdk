/**
 * Canonical Mixpanel super-property key names.
 *
 * These are the keys we register as Mixpanel super-properties at SDK
 * init and skip from per-event payloads (`buildFlat()`) to avoid
 * double-shipping the same data on every event.
 *
 * Kept in one place so:
 *   - A typo in any one consumer (mixpanel module, attribution service,
 *     event-properties builder, BigQuery export query, dashboards) is
 *     surfaced at compile time, not via "no data" alerts in prod.
 *   - The bracket format `utm_X [first touch]` (Mixpanel's stock
 *     convention) is documented once, not repeated.
 *
 * Used by `src/common/event-properties-builder.ts` and any future
 * module that registers Mixpanel super-properties.
 */

export const UTM_FIRST_TOUCH = {
  source: 'utm_source [first touch]',
  medium: 'utm_medium [first touch]',
  campaign: 'utm_campaign [first touch]',
  content: 'utm_content [first touch]',
  term: 'utm_term [first touch]',
} as const;

export const UTM_LAST_TOUCH = {
  source: 'utm_source [last touch]',
  medium: 'utm_medium [last touch]',
  campaign: 'utm_campaign [last touch]',
  content: 'utm_content [last touch]',
  term: 'utm_term [last touch]',
} as const;

export const MARKETING_ATTRIBUTION_KEY = 'marketing_attribution';

/**
 * The full set of keys that are registered as Mixpanel super-properties
 * elsewhere in the SDK. Used by buildFlat() to skip these when assembling
 * per-event payloads.
 */
export const MIXPANEL_SUPER_PROPERTY_KEYS: ReadonlyArray<string> = [
  MARKETING_ATTRIBUTION_KEY,
  UTM_FIRST_TOUCH.source,
  UTM_FIRST_TOUCH.medium,
  UTM_FIRST_TOUCH.campaign,
  UTM_LAST_TOUCH.source,
  UTM_LAST_TOUCH.medium,
  UTM_LAST_TOUCH.campaign,
];

/** Hash form for O(1) lookup in hot-path filter loops. */
export const MIXPANEL_SUPER_PROPERTY_KEYS_SET: Readonly<Record<string, true>> =
  MIXPANEL_SUPER_PROPERTY_KEYS.reduce<Record<string, true>>((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});
