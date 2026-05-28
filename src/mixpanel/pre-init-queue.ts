/**
 * Pre-init buffer for ops that arrive BEFORE both Mixpanel instances are
 * loaded. Without this, modules that initialize concurrently with mixpanel
 * (analytics auto-pageview, login bootstrap, etc.) silently drop events.
 *
 * Industry-standard pattern: the caller-facing dispatcher always succeeds;
 * the SDK handles buffering internally. Matches Segment, Amplitude, Heap,
 * and Mixpanel's own loader-stub design.
 *
 * Cap to prevent unbounded growth if init never completes (misconfig).
 * 200 events ≈ a few minutes of heavy auto-tracking. Drain produces 2×
 * HTTP requests when both instances are enabled.
 */
import type { DispatchOptions, MixpanelOp } from '@src/types/mixpanel.types';
import { DEFAULTS } from '@src/mixpanel/messages';

export interface QueueEntry {
  op: MixpanelOp;
  args: unknown[];
  options?: DispatchOptions;
}

const PRE_INIT_QUEUE_MAX = DEFAULTS.PRE_INIT_QUEUE_MAX;

const queue: QueueEntry[] = [];
let overflowWarned = false;
let onOverflow: ((dropped: QueueEntry) => void) | null = null;

export function setOverflowHandler(handler: (dropped: QueueEntry) => void): void {
  onOverflow = handler;
}

/** Push an entry into the queue. Returns false when the cap was hit. */
export function enqueue(entry: QueueEntry): boolean {
  if (queue.length >= PRE_INIT_QUEUE_MAX) {
    if (!overflowWarned && onOverflow) {
      overflowWarned = true;
      onOverflow(entry);
    }
    return false;
  }
  queue.push(entry);
  return true;
}

/** Drain and return all queued entries. The caller is responsible for
 *  replaying them through the dispatcher. */
export function drain(): QueueEntry[] {
  if (queue.length === 0) return [];
  return queue.splice(0, queue.length);
}

export function size(): number {
  return queue.length;
}

/** Test-only — clear the queue and reset the overflow-warned flag. */
export function resetQueue(): void {
  queue.length = 0;
  overflowWarned = false;
}

