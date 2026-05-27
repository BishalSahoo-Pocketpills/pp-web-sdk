/**
 * Ensure window.dataLayer exists as an array. Call before any
 * dataLayer.push() — idempotent, no-op if already initialised.
 */
export function ensureDataLayer(win: Window & typeof globalThis): unknown[] {
  const w = win as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  return w.dataLayer;
}
