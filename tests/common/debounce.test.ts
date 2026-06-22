/**
 * Direct unit tests for the debounce tracker — in particular the prune sweep
 * that bounds map growth. The ecommerce integration test only set up the prune
 * scenario and asserted expect(true).toBe(true); these assert the actual
 * contract: duplicates within the window are caught, and the stale-entry sweep
 * shrinks the map (via the size() observability hook) while keeping fresh keys.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebounceTracker } from '../../src/common/debounce';

describe('createDebounceTracker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('treats a repeat within the window as a duplicate, and a later repeat as fresh', () => {
    const tracker = createDebounceTracker({ debounceMs: 300 });
    expect(tracker.isDuplicate('a')).toBe(false); // first sighting
    expect(tracker.isDuplicate('a')).toBe(true);  // within 300ms → duplicate
    vi.advanceTimersByTime(301);
    expect(tracker.isDuplicate('a')).toBe(false); // window elapsed → fresh
  });

  it('reflects live config changes to debounceMs', () => {
    const config = { debounceMs: 300 };
    const tracker = createDebounceTracker(config);
    tracker.isDuplicate('k');
    vi.advanceTimersByTime(200);
    expect(tracker.isDuplicate('k')).toBe(true); // still inside 300ms
    config.debounceMs = 100; // shrink the window at runtime
    expect(tracker.isDuplicate('k')).toBe(false); // 200ms now exceeds 100ms
  });

  it('prunes stale entries at the threshold but keeps fresh ones (size shrinks)', () => {
    // Small threshold for a deterministic test.
    const tracker = createDebounceTracker({ debounceMs: 300 }, 5);

    // Seed 4 stale keys (each becomes stale once we advance past the window).
    tracker.isDuplicate('s1');
    tracker.isDuplicate('s2');
    tracker.isDuplicate('s3');
    tracker.isDuplicate('s4');
    expect(tracker.size()).toBe(4);

    // Make them all stale.
    vi.advanceTimersByTime(301);

    // A fresh key right before the sweep fires.
    tracker.isDuplicate('fresh'); // write #5 → triggers prune of the 4 stale keys

    // The four stale keys are swept; only the fresh key remains.
    expect(tracker.size()).toBe(1);
    // And the fresh key is genuinely still tracked (immediate repeat = duplicate).
    expect(tracker.isDuplicate('fresh')).toBe(true);
  });
});
