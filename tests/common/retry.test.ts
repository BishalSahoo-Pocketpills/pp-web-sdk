import { describe, it, expect, vi, afterEach } from 'vitest';
import { pollUntil, withRetryAsync } from '@src/common/retry';

describe('pollUntil', () => {
  afterEach(() => vi.useRealTimers());

  it('returns immediately when check() is already true (no timer scheduled)', () => {
    vi.useFakeTimers();
    const check = vi.fn(() => true);
    pollUntil({ check, intervalMs: 100, maxAttempts: 5 });
    expect(check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('polls until check() returns true, then stops', () => {
    vi.useFakeTimers();
    let n = 0;
    const check = vi.fn(() => ++n >= 3);
    pollUntil({ check, intervalMs: 100, maxAttempts: 10 });
    vi.advanceTimersByTime(500);
    expect(check).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at maxAttempts and fires onMaxAttempts', () => {
    vi.useFakeTimers();
    const onMaxAttempts = vi.fn();
    const check = vi.fn(() => false);
    pollUntil({ check, intervalMs: 100, maxAttempts: 3, onMaxAttempts });
    vi.advanceTimersByTime(1000);
    expect(check).toHaveBeenCalledTimes(4); // 1 immediate + 3 interval
    expect(onMaxAttempts).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onMaxAttempts on natural success', () => {
    vi.useFakeTimers();
    const onMaxAttempts = vi.fn();
    pollUntil({ check: () => true, intervalMs: 100, maxAttempts: 5, onMaxAttempts });
    expect(onMaxAttempts).not.toHaveBeenCalled();
  });

  it('cancel() stops further checks', () => {
    vi.useFakeTimers();
    const check = vi.fn(() => false);
    const handle = pollUntil({ check, intervalMs: 100, maxAttempts: 10 });
    vi.advanceTimersByTime(200);
    handle.cancel();
    vi.advanceTimersByTime(500);
    // 1 immediate + 2 from the first advance — no more after cancel
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('cancel() after natural completion is a safe no-op', () => {
    const handle = pollUntil({ check: () => true, intervalMs: 100, maxAttempts: 5 });
    expect(() => handle.cancel()).not.toThrow();
  });
});

describe('withRetryAsync', () => {
  afterEach(() => vi.useRealTimers());

  it('returns on first success without scheduling a delay', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetryAsync({ fn, attempts: 3, baseDelay: 100 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to attempts on failure', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fn = vi.fn(() => {
      n++;
      return n < 3 ? Promise.reject(new Error('fail')) : Promise.resolve('ok');
    });
    const promise = withRetryAsync({ fn, attempts: 5, baseDelay: 10 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const promise = withRetryAsync({ fn, attempts: 3, baseDelay: 10 });
    const assertion = expect(promise).rejects.toThrow('always fails');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('shouldRetry=false short-circuits without further attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('client error'));
    const shouldRetry = vi.fn(() => false);
    await expect(withRetryAsync({ fn, attempts: 5, baseDelay: 10, shouldRetry }))
      .rejects.toThrow('client error');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff delay between attempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const promise = withRetryAsync({ fn, attempts: 3, baseDelay: 100 });
    // Suppress unhandled rejection on the in-flight promise.
    promise.catch(() => undefined);

    expect(fn).toHaveBeenCalledTimes(1);
    // First retry waits baseDelay*2^0 = 100ms
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    // Second retry waits baseDelay*2^1 = 200ms
    await vi.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).rejects.toThrow('fail');
  });
});
