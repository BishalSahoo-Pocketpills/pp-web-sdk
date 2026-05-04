export interface DebounceTracker {
  isDuplicate: (key: string) => boolean;
}

/**
 * Factory for time-window debounce tracking.
 * Prevents duplicate events for the same element/key within a configurable window.
 * Prunes stale entries every `pruneThreshold` writes to prevent unbounded map growth.
 *
 * Accepts a config object so debounceMs stays live — callers can update
 * the value via configure() and the tracker reflects the change immediately.
 */
export function createDebounceTracker(config: { debounceMs: number }, pruneThreshold?: number): DebounceTracker {
  var threshold = pruneThreshold || 100;
  var lastEventMap: Record<string, number> = {};
  var writeCount = 0;

  function isDuplicate(key: string): boolean {
    var ms = config.debounceMs;
    var now = Date.now();

    if (++writeCount >= threshold) {
      writeCount = 0;
      for (var k in lastEventMap) {
        if ((now - lastEventMap[k]) >= ms) {
          delete lastEventMap[k];
        }
      }
    }

    if (lastEventMap[key] && (now - lastEventMap[key]) < ms) {
      return true;
    }
    lastEventMap[key] = now;
    return false;
  }

  return { isDuplicate: isDuplicate };
}
