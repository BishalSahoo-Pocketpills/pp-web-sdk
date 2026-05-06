/**
 * DataLayer Enricher Coordinator
 *
 * Composable higher-order function system for enriching dataLayer events.
 * Modules register enricher HOFs via ppLib.registerEnricher(). The coordinator
 * wraps dataLayer.push once and dynamically composes all registered enrichers
 * on every push call — so late-registered enrichers are automatically active.
 *
 * Each enricher is a HOF: (pushFn) => wrappedPushFn
 */
import type { PPLib } from '@src/types/common.types';

// Push args are intentionally `unknown[]` — the dataLayer accepts arbitrary
// shapes from any caller (GTM tags, third-party scripts, our own modules).
// Enrichers must validate before treating an arg as an event object.
type PushFn = (...args: unknown[]) => number;
export type EnricherFn = (pushFn: PushFn) => PushFn;

export function createDataLayerEnricher(win: Window & typeof globalThis, ppLib: PPLib) {
  let applied = false;

  function registerEnricher(enricherFn: EnricherFn): void {
    ppLib._enrichers = ppLib._enrichers || [];
    ppLib._enrichers.push(enricherFn);
    ppLib.log('info', '[ppEnricher] Enricher registered (total: ' + ppLib._enrichers.length + ')');
  }

  function applyEnrichers(): void {
    if (applied) return;
    applied = true;

    const dl: unknown[] = win.dataLayer = win.dataLayer || [];
    const originalPush: PushFn = dl.push.bind(dl) as PushFn;

    // Re-entrancy guard — prevents infinite recursion if an enricher
    // calls dataLayer.push internally
    let processing = false;

    dl.push = function(this: unknown[]): number {
      const args = Array.prototype.slice.call(arguments) as unknown[];
      if (processing) {
        return originalPush.apply(dl, args);
      }

      processing = true;
      try {
        // Compose all registered enrichers dynamically (reads at call time)
        const enrichers: EnricherFn[] = ppLib._enrichers || [];
        let composed: PushFn = originalPush;
        for (let i = 0; i < enrichers.length; i++) {
          composed = enrichers[i](composed);
        }
        return composed.apply(dl, args);
      } finally {
        processing = false;
      }
    } as typeof dl.push;

    ppLib.log('info', '[ppEnricher] dataLayer.push enrichment active');
  }

  return { registerEnricher: registerEnricher, applyEnrichers: applyEnrichers };
}
