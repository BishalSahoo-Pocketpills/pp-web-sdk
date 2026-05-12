/**
 * Shared retry primitives.
 *
 * Two patterns recur across the SDK that look similar but have distinct
 * semantics — extracted here so the call sites stay short and the
 * behavior stays consistent.
 *
 * - `pollUntil` — setInterval-based polling for "wait for a synchronous
 *   condition to become true" (e.g. third-party SDK exposes a global
 *   after async load). Cancellable; bails after maxAttempts.
 *
 * - `withRetryAsync` — promise-based exponential-backoff retry for
 *   "fetch this and retry the failure" (e.g. Voucherify API). Honours a
 *   `shouldRetry` predicate so 4xx client errors can short-circuit.
 *
 * These deliberately don't share an implementation — polling is "keep
 * checking until X" and retrying is "do once, on failure do again with
 * backoff". Folding them into one HOF forces awkward type contortions
 * for marginal DRY benefit.
 */

export interface PollHandle {
  /** Cancels the poll. Safe to call after natural completion. */
  cancel: () => void;
}

export interface PollUntilOptions {
  /**
   * Predicate run on each tick. Return `true` to stop polling. Run
   * once synchronously before the first interval tick so a condition
   * that's already true doesn't wait for `intervalMs`.
   */
  check: () => boolean;
  /** Milliseconds between checks. */
  intervalMs: number;
  /** Maximum number of interval ticks before giving up. */
  maxAttempts: number;
  /**
   * Optional callback when the poll exits because `maxAttempts` was
   * reached without `check()` ever returning true. Not called on
   * cancel or on a successful check.
   */
  onMaxAttempts?: () => void;
  /**
   * Window object to schedule timers on. Defaults to global window.
   * Tests inject a mock for fake-timer control.
   */
  win?: Window & typeof globalThis;
}

/**
 * Poll `check` every `intervalMs` until it returns true or `maxAttempts`
 * is reached. Returns a handle whose `cancel()` aborts the poll.
 *
 * Runs `check()` once synchronously first — a condition that's already
 * true returns immediately and never schedules a timer.
 */
export function pollUntil(opts: PollUntilOptions): PollHandle {
  const w = opts.win || (typeof window !== 'undefined' ? window : (globalThis as Window & typeof globalThis));

  if (opts.check()) {
    return { cancel: () => undefined };
  }

  let attempts = 0;
  let intervalId: ReturnType<Window['setInterval']> | null = w.setInterval(function() {
    attempts++;
    if (opts.check()) {
      if (intervalId !== null) {
        w.clearInterval(intervalId);
        intervalId = null;
      }
      return;
    }
    if (attempts >= opts.maxAttempts) {
      if (intervalId !== null) {
        w.clearInterval(intervalId);
        intervalId = null;
      }
      if (opts.onMaxAttempts) opts.onMaxAttempts();
    }
  }, opts.intervalMs);

  return {
    cancel: function() {
      if (intervalId !== null) {
        w.clearInterval(intervalId);
        intervalId = null;
      }
    }
  };
}

export interface RetryAsyncOptions<T> {
  /** Operation to attempt. Re-invoked from scratch on each retry. */
  fn: () => Promise<T>;
  /** Total attempts (including the first). `attempts: 3` = initial try + 2 retries. */
  attempts: number;
  /** Base delay in ms; effective delay is `baseDelay * 2^attempt`. */
  baseDelay: number;
  /**
   * Predicate called with the rejected value. Return `false` to abort
   * without further retries (e.g. 4xx HTTP from a fetch). Default
   * behavior is to retry every failure.
   */
  shouldRetry?: (err: unknown) => boolean;
  /**
   * Window for setTimeout. Tests inject a mock for fake-timer control.
   */
  win?: Window & typeof globalThis;
}

/**
 * Promise-based retry with exponential backoff. Returns the first
 * successful result from `fn`. After exhausting attempts, throws the
 * last rejection.
 */
export async function withRetryAsync<T>(opts: RetryAsyncOptions<T>): Promise<T> {
  const w = opts.win || (typeof window !== 'undefined' ? window : (globalThis as Window & typeof globalThis));
  const shouldRetry = opts.shouldRetry || (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      return await opts.fn();
    } catch (e) {
      lastError = e;
      if (!shouldRetry(e)) break;
      if (attempt < opts.attempts - 1) {
        await new Promise<void>(function(resolve) {
          w.setTimeout(resolve, opts.baseDelay * Math.pow(2, attempt));
        });
      }
    }
  }

  throw lastError;
}
