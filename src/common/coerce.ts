/**
 * Numeric coercion helpers for ecommerce payloads.
 *
 * The DOM scrape and the public `trackItem` surface hand us prices/discounts
 * as raw strings (`data-ecommerce-price="29.99"`) or loosely-typed inputs.
 * Per the Analytics events spec, monetary fields must leave the SDK as
 * floats (decimal) and counts as integers — so both the nested GA4
 * (dataLayer/GTM) shape and the flat Mixpanel shape carry real numbers, not
 * strings. These helpers centralise that conversion with a safe `0`
 * fallback so a malformed attribute never emits `NaN`.
 */

/**
 * Coerce a money-like value to a float rounded to 2 decimal places (currency
 * precision); non-numeric / missing → 0. The `* 100` round also clears binary
 * float artifacts (e.g. 29.99 → 2998.9999… → 2999 → 29.99).
 */
export function toFloat(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}
