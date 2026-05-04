import type { PPLib } from '@src/types/common.types';

export interface EventGuard {
  claim: (eventName: string) => boolean;
  hasFired: (eventName: string) => boolean;
}

/**
 * Cross-module event deduplication.
 *
 * When multiple modules can fire the same event (e.g. view_item from both
 * ecommerce and datalayer), this guard ensures only the first caller wins.
 *
 * Uses ppLib._firedEvents as the shared runtime registry.
 */
export function createEventGuard(ppLib: PPLib): EventGuard {
  function claim(eventName: string): boolean {
    var fired = ppLib._firedEvents || (ppLib._firedEvents = {});
    if (fired[eventName]) return false;
    fired[eventName] = true;
    return true;
  }

  function hasFired(eventName: string): boolean {
    return !!(ppLib._firedEvents && ppLib._firedEvents[eventName]);
  }

  return { claim: claim, hasFired: hasFired };
}
