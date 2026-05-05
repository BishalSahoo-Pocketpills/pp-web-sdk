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
  const threshold = pruneThreshold || 100;
  const lastEventMap: Record<string, number> = {};
  let writeCount = 0;

  function isDuplicate(key: string): boolean {
    const ms = config.debounceMs;
    const now = Date.now();

    if (++writeCount >= threshold) {
      writeCount = 0;
      for (const k in lastEventMap) {
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
