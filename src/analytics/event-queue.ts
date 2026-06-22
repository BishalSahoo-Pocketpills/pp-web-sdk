import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig, QueueEvent, RateLimitEntry } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';
import type { AnalyticsPlatforms, MixpanelQueueData } from '@src/analytics/platforms';

export interface AnalyticsEventQueue {
  queue: QueueEvent[];
  processing: boolean;
  droppedCount: number;
  rateLimits: Record<string, RateLimitEntry>;
  add: (event: QueueEvent) => void;
  process: (event: QueueEvent) => void;
  processQueue: (deadline?: IdleDeadline) => void;
  scheduleProcessing: () => void;
  flush: () => void;
  checkRateLimit: (key: string, max: number, windowMs: number) => boolean;
}

// A queue/batch size must be a positive integer; a misconfigured 0, negative,
// fractional, or non-number value would otherwise stall the drain or evict
// everything, so we floor to the safe default rather than trusting the input.
function positiveIntOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 1 ? Math.floor(value) : fallback;
}

export function createEventQueue(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: AnalyticsConfig,
  utils: AnalyticsUtils,
  platforms: AnalyticsPlatforms
): AnalyticsEventQueue {
  const SafeUtils = ppLib.SafeUtils;

  const state: AnalyticsEventQueue = {
    queue: [] as QueueEvent[],
    processing: false,
    droppedCount: 0,
    rateLimits: {} as Record<string, RateLimitEntry>,
    add: addEvent,
    process: processEvent,
    processQueue: processQueue,
    scheduleProcessing: scheduleProcessing,
    flush: flush,
    checkRateLimit: checkRateLimit
  };

  let rateLimitWriteCount = 0;

  // Best-effort synchronous drain on page teardown (F6 safety net). The
  // cooperative drain can leave events buffered across idle callbacks; without
  // this they would be lost when the user navigates away. processEvent's
  // destinations (dataLayer push, Mixpanel sendBeacon) survive unload, so a
  // synchronous drain here actually delivers. Registered for both pagehide and
  // the visibility→hidden transition (bfcache / mobile background).
  win.addEventListener('pagehide', flush);
  win.document.addEventListener('visibilitychange', function() {
    if (win.document.visibilityState === 'hidden') flush();
  });

  function addEvent(event: QueueEvent): void {
    try {
      if (!event || typeof event !== 'object') return;

      if (!SafeUtils.get(CONFIG, 'performance.queueEnabled', true)) {
        processEvent(event);
        return;
      }

      const maxSize = positiveIntOr(SafeUtils.get(CONFIG, 'performance.maxQueueSize', 50), 50);
      if (state.queue.length >= maxSize) {
        // Overflow policy (F5): the queue is bounded to protect memory and the
        // main thread. We DROP THE INCOMING event rather than evicting a queued
        // one, so the already-buffered prefix — e.g. first-touch / attribution
        // events emitted at the head of the journey — stays intact. Ordering
        // matters more for funnel reconstruction than capturing one extra tail
        // event under distress. The drop is counted unconditionally (the warn
        // log is debug-gated) so sustained shedding is observable in the field.
        state.droppedCount++;
        utils.log('warn', 'Event queue full (maxSize=' + maxSize + '), dropping incoming event; total dropped=' + state.droppedCount);
        return;
      }

      state.queue.push(event);
      scheduleProcessing();
    } catch (e) {
      utils.log('error', 'Queue add error', e);
    }
  }

  function scheduleProcessing(): void {
    try {
      if (state.processing) return;

      const useIdleCallback = SafeUtils.get(CONFIG, 'performance.useRequestIdleCallback', true);

      if (useIdleCallback && typeof win.requestIdleCallback === 'function') {
        win.requestIdleCallback(function(deadline) {
          processQueue(deadline);
        }, { timeout: 2000 });
      } else {
        setTimeout(function() {
          processQueue();
        }, 0);
      }
    } catch (e) {
      utils.log('error', 'Schedule processing error', e);
    }
  }

  function processQueue(deadline?: IdleDeadline): void {
    try {
      state.processing = true;

      const batchSize = positiveIntOr(SafeUtils.get(CONFIG, 'performance.drainBatchSize', 25), 25);
      let processedThisTurn = 0;

      while (state.queue.length > 0) {
        // Hard cap on work per turn (both the rIC and setTimeout paths), so a
        // large backlog can never become one long task — the remainder is
        // rescheduled below.
        if (processedThisTurn >= batchSize) break;

        // Cooperative yield (F6): under requestIdleCallback, also stop early
        // once the frame's idle budget is spent — but ONLY after draining at
        // least one event, so every turn makes forward progress and we never
        // spin rescheduling zero work. If the rIC timeout already fired
        // (didTimeout), ignore the spent budget and drain up to the batch cap.
        if (deadline && processedThisTurn > 0 && deadline.timeRemaining() <= 0 && !deadline.didTimeout) break;

        // length > 0 guarantees a value, so no per-item null check is needed.
        const event = state.queue.shift() as QueueEvent;
        processEvent(event);
        processedThisTurn++;
      }

      state.processing = false;

      // If we yielded with events still queued, reschedule the remainder.
      // processing is already false, so scheduleProcessing won't early-return.
      if (state.queue.length > 0) {
        scheduleProcessing();
      }
    } catch (e) {
      utils.log('error', 'Process queue error', e);
      state.processing = false;
    }
  }

  function flush(): void {
    try {
      while (state.queue.length > 0) {
        processEvent(state.queue.shift() as QueueEvent);
      }
    } catch (e) {
      utils.log('error', 'Queue flush error', e);
    }
  }

  function checkRateLimit(key: string, max: number, windowMs: number): boolean {
    try {
      if (!SafeUtils.exists(key)) return false;

      const now = Date.now();

      if (!state.rateLimits[key]) {
        state.rateLimits[key] = { count: 0, resetAt: now + windowMs };
      }

      const limit = state.rateLimits[key];

      if (now > limit.resetAt) {
        limit.count = 0;
        limit.resetAt = now + windowMs;
      }

      if (limit.count >= max) {
        utils.log('warn', 'Rate limit exceeded for ' + key);
        return false;
      }

      limit.count++;

      // Prune expired rate-limit entries every 50 writes to bound memory.
      if (++rateLimitWriteCount >= 50) {
        rateLimitWriteCount = 0;
        for (const k in state.rateLimits) {
          if (now > state.rateLimits[k].resetAt) {
            delete state.rateLimits[k];
          }
        }
      }

      return true;
    } catch (e) {
      // Fail OPEN (F14): allow the event for availability — a rate-limiter
      // fault must never silently swallow analytics. Log so it's observable.
      utils.log('error', 'Rate limit check error (failing open)', ppLib.safeLogError(e));
      return true;
    }
  }

  function processEvent(event: QueueEvent): void {
    try {
      if (!event || !event.type) return;

      const eventType = SafeUtils.toString(event.type);

      if (eventType === 'gtm' && SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
        const max = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitMax', 100);
        const windowMs = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitWindow', 60000);

        if (checkRateLimit('gtm', max, windowMs)) {
          platforms.GTM.push(event.data);
        } else {
          utils.log('warn', 'GTM event dropped (rate limit): ' + SafeUtils.get(event.data, 'event', '(unknown)'));
        }
      } else if (eventType === 'mixpanel' && SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
        platforms.Mixpanel.send(event.data as MixpanelQueueData);
      } else if (eventType === 'custom') {
        if (event.handler && typeof event.handler === 'function') {
          event.handler(event.data);
        }
      }
    } catch (e) {
      utils.log('error', 'Event processing error', e);
    }
  }

  return state;
}
