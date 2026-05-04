import { createDataLayerEnricher } from '../../src/common/datalayer-enricher';
import type { PPLib } from '../../src/types/common.types';

function makePPLib(): PPLib {
  return {
    log: vi.fn(),
    _enrichers: undefined,
  } as any;
}

describe('createDataLayerEnricher', () => {
  beforeEach(() => {
    delete (window as any).dataLayer;
  });

  it('registerEnricher adds to ppLib._enrichers', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);
    const fn = (push: any) => push;

    enricher.registerEnricher(fn);
    expect(ppLib._enrichers).toHaveLength(1);
    expect(ppLib._enrichers![0]).toBe(fn);
  });

  it('applyEnrichers wraps dataLayer.push', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);
    enricher.applyEnrichers();

    expect(window.dataLayer).toBeDefined();
    // push should still work
    window.dataLayer.push({ event: 'test' });
    expect(window.dataLayer.length).toBeGreaterThanOrEqual(1);
  });

  it('enrichers modify events before push', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);

    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event) {
            args[i].enriched = true;
          }
        }
        return pushFn.apply(null, args);
      };
    });

    enricher.applyEnrichers();
    window.dataLayer.push({ event: 'test' });

    const lastEvent = window.dataLayer[window.dataLayer.length - 1];
    expect(lastEvent.enriched).toBe(true);
  });

  it('skips non-event objects (ecommerce null clear)', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);
    var called = false;

    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event) {
            called = true;
          }
        }
        return pushFn.apply(null, args);
      };
    });

    enricher.applyEnrichers();
    window.dataLayer.push({ ecommerce: null });
    expect(called).toBe(false);
  });

  it('late-registered enrichers are picked up dynamically', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);
    enricher.applyEnrichers();

    // Register AFTER applyEnrichers
    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event) {
            args[i].lateEnriched = true;
          }
        }
        return pushFn.apply(null, args);
      };
    });

    window.dataLayer.push({ event: 'late_test' });
    const lastEvent = window.dataLayer[window.dataLayer.length - 1];
    expect(lastEvent.lateEnriched).toBe(true);
  });

  it('applyEnrichers is idempotent', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);
    enricher.applyEnrichers();
    const firstPush = window.dataLayer.push;
    enricher.applyEnrichers(); // second call
    expect(window.dataLayer.push).toBe(firstPush);
  });

  it('re-entrancy guard prevents infinite recursion', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);

    // Enricher that pushes to dataLayer internally
    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event === 'trigger') {
            // This should bypass enrichment (re-entrancy guard)
            window.dataLayer.push({ event: 'inner', fromEnricher: true });
          }
        }
        return pushFn.apply(null, args);
      };
    });

    enricher.applyEnrichers();
    window.dataLayer.push({ event: 'trigger' });

    // Should not infinite loop
    const inner = window.dataLayer.find((e: any) => e.event === 'inner');
    expect(inner).toBeDefined();
    expect(inner.fromEnricher).toBe(true);
  });

  it('multiple enrichers compose correctly', () => {
    const ppLib = makePPLib();
    const enricher = createDataLayerEnricher(window, ppLib);

    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event) args[i].first = true;
        }
        return pushFn.apply(null, args);
      };
    });

    enricher.registerEnricher(function(pushFn) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        for (var i = 0; i < args.length; i++) {
          if (args[i] && args[i].event) args[i].second = true;
        }
        return pushFn.apply(null, args);
      };
    });

    enricher.applyEnrichers();
    window.dataLayer.push({ event: 'multi' });

    const lastEvent = window.dataLayer[window.dataLayer.length - 1];
    expect(lastEvent.first).toBe(true);
    expect(lastEvent.second).toBe(true);
  });
});
