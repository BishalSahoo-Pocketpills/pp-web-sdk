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

export type EnricherFn = (pushFn: (...args: any[]) => number) => (...args: any[]) => number;

export function createDataLayerEnricher(win: Window & typeof globalThis, ppLib: PPLib) {
  var applied = false;

  function registerEnricher(enricherFn: EnricherFn): void {
    ppLib._enrichers = ppLib._enrichers || [];
    ppLib._enrichers.push(enricherFn);
    ppLib.log('info', '[ppEnricher] Enricher registered (total: ' + ppLib._enrichers.length + ')');
  }

  function applyEnrichers(): void {
    if (applied) return;
    applied = true;

    var dl: any[] = win.dataLayer = win.dataLayer || [];
    var originalPush = dl.push.bind(dl);

    // Re-entrancy guard — prevents infinite recursion if an enricher
    // calls dataLayer.push internally
    var processing = false;

    dl.push = function() {
      var args = Array.prototype.slice.call(arguments) as any[];
      if (processing) {
        return originalPush.apply(dl, args);
      }

      processing = true;
      try {
        // Compose all registered enrichers dynamically (reads at call time)
        var enrichers: EnricherFn[] = ppLib._enrichers || [];
        var composed = originalPush;
        for (var i = 0; i < enrichers.length; i++) {
          composed = enrichers[i](composed);
        }
        return composed.apply(dl, args);
      } finally {
        processing = false;
      }
    };

    ppLib.log('info', '[ppEnricher] dataLayer.push enrichment active');
  }

  return { registerEnricher: registerEnricher, applyEnrichers: applyEnrichers };
}
