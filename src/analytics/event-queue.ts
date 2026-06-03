import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig, QueueEvent, RateLimitEntry } from '@src/types/analytics.types';
import type { AnalyticsUtils } from '@src/analytics/utils';
import type { AnalyticsPlatforms, MixpanelQueueData } from '@src/analytics/platforms';

export interface AnalyticsEventQueue {
  queue: QueueEvent[];
  processing: boolean;
  rateLimits: Record<string, RateLimitEntry>;
  add: (event: QueueEvent) => void;
  process: (event: QueueEvent) => void;
  processQueue: () => void;
  scheduleProcessing: () => void;
  checkRateLimit: (key: string, max: number, windowMs: number) => boolean;
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
    rateLimits: {} as Record<string, RateLimitEntry>,
    add: addEvent,
    process: processEvent,
    processQueue: processQueue,
    scheduleProcessing: scheduleProcessing,
    checkRateLimit: checkRateLimit
  };

  let rateLimitWriteCount = 0;

  function addEvent(event: QueueEvent): void {
    try {
      /*! v8 ignore start */
      if (!event || typeof event !== 'object') return;

      if (!SafeUtils.get(CONFIG, 'performance.queueEnabled', true)) {
      /*! v8 ignore stop */
        processEvent(event);
        return;
      }

      const maxSize = SafeUtils.get(CONFIG, 'performance.maxQueueSize', 50);
      /*! v8 ignore start */
      if (state.queue.length >= maxSize) {
      /*! v8 ignore stop */
        utils.log('warn', 'Event queue full, dropping event');
      } else {
        state.queue.push(event);
        scheduleProcessing();
      }
    } catch (e) {
      utils.log('error', 'Queue add error', e);
    }
  }

  function scheduleProcessing(): void {
    try {
      /*! v8 ignore start */
      if (state.processing) return;
      /*! v8 ignore stop */

      const useIdleCallback = SafeUtils.get(CONFIG, 'performance.useRequestIdleCallback', true);

      /*! v8 ignore start */
      if (useIdleCallback && typeof win.requestIdleCallback === 'function') {
      /*! v8 ignore stop */
        win.requestIdleCallback(function() {
          processQueue();
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

  function processQueue(): void {
    try {
      state.processing = true;

      while (state.queue.length > 0) {
        const event = state.queue.shift();
        /*! v8 ignore start */
        if (event) {
        /*! v8 ignore stop */
          processEvent(event);
        }
      }

      state.processing = false;
    } catch (e) {
      utils.log('error', 'Process queue error', e);
      state.processing = false;
    }
  }

  function checkRateLimit(key: string, max: number, windowMs: number): boolean {
    try {
      /*! v8 ignore start */
      if (!SafeUtils.exists(key)) return false;
      /*! v8 ignore stop */

      const now = Date.now();

      /*! v8 ignore start */
      if (!state.rateLimits[key]) {
      /*! v8 ignore stop */
        state.rateLimits[key] = { count: 0, resetAt: now + windowMs };
      }

      const limit = state.rateLimits[key];

      /*! v8 ignore start */
      if (now > limit.resetAt) {
      /*! v8 ignore stop */
        limit.count = 0;
        limit.resetAt = now + windowMs;
      }

      /*! v8 ignore start */
      if (limit.count >= max) {
      /*! v8 ignore stop */
        utils.log('warn', 'Rate limit exceeded for ' + key);
        return false;
      }

      limit.count++;

      /*! v8 ignore start */
      // Prune expired rate limit entries every 50 writes to prevent unbounded growth
      if (++rateLimitWriteCount >= 50) {
        rateLimitWriteCount = 0;
        for (const k in state.rateLimits) {
          if (now > state.rateLimits[k].resetAt) {
            delete state.rateLimits[k];
          }
        }
      }
      /*! v8 ignore stop */

      return true;
    } catch (e) {
      return true;
    }
  }

  function processEvent(event: QueueEvent): void {
    try {
      /*! v8 ignore start */
      if (!event || !event.type) return;
      /*! v8 ignore stop */

      const eventType = SafeUtils.toString(event.type);

      if (eventType === 'gtm' && SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
        const max = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitMax', 100);
        const windowMs = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitWindow', 60000);

        /*! v8 ignore start */
        if (checkRateLimit('gtm', max, windowMs)) {
          platforms.GTM.push(event.data);
        } else {
          utils.log('warn', 'GTM event dropped (rate limit): ' + SafeUtils.get(event.data, 'event', '(unknown)'));
        }
      } else if (eventType === 'mixpanel' && SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
        platforms.Mixpanel.send(event.data as MixpanelQueueData);
      /*! v8 ignore stop */
      /*! v8 ignore start */
      } else if (eventType === 'custom') {
        if (event.handler && typeof event.handler === 'function') {
          event.handler(event.data);
        }
      }
      /*! v8 ignore stop */
    } catch (e) {
      utils.log('error', 'Event processing error', e);
    }
  }

  return state;
}
