/**
 * Default cap on `window.dataLayer` length. `pushToDataLayer` front-trims to
 * this size so a long session can't grow the array without bound.
 */
export const DATALAYER_CAP = 1000;

/**
 * Ensure window.dataLayer exists as an array. Call before any
 * dataLayer.push() — idempotent, no-op if already initialised.
 */
export function ensureDataLayer(win: Window & typeof globalThis): unknown[] {
  const w = win as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  return w.dataLayer;
}

/**
 * Single entry point for every `window.dataLayer` push in the SDK (analytics,
 * datalayer, ecommerce, event-source, vwo). Ensures the array exists,
 * front-trims it to at most `cap` entries (removing the OLDEST, already-pushed
 * entries) so it can't grow unbounded across a long session, then pushes.
 * window.dataLayer is shared with GTM and other tags, but every consumer (GTM,
 * our datalayer enricher, the Braze bridge) processes each entry AT PUSH TIME
 * into its own model and never re-reads the array by index — so removing
 * already-pushed front entries is safe. The native `splice` is deliberately
 * invisible to those `push` wrappers; do NOT route the trim through
 * dl.shift/dl.push (it would re-trigger the enrichers). Callers
 * validate/sanitize the payload before calling.
 */
export function pushToDataLayer(
  win: Window & typeof globalThis,
  payload: unknown,
  cap: number = DATALAYER_CAP
): void {
  const dl = ensureDataLayer(win);
  if (dl.length >= cap) {
    dl.splice(0, dl.length - cap + 1);
  }
  dl.push(payload);
}
