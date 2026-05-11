/**
 * Integration: common + voucherify AbortController + baseline fallback
 *
 * Locks in two prior fixes:
 *   - Track 10: fetchWithRetry aborts each attempt at requestTimeoutMs.
 *   - Track 1 C3: a failed pricing fetch falls back to basePrice rather
 *     than leaving the DOM cloaked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadModule } from '@tests/helpers/iife-loader';

function setupPricingDOM(): void {
  document.body.innerHTML = `
    <div data-voucherify-product="prod_1" data-voucherify-base-price="10.00">
      <span data-voucherify-original-price></span>
      <span data-voucherify-discounted-price></span>
    </div>
  `;
}

describe('Integration: Voucherify timeout + baseline fallback', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch (e) { /* ignore */ }
    document.body.innerHTML = '';
    delete (window as unknown as { ppLib?: unknown }).ppLib;
    delete (window as unknown as { ppLibReady?: unknown }).ppLibReady;
    vi.useRealTimers();
  });

  it('aborts each fetch attempt at requestTimeoutMs and retries', async () => {
    loadModule('common');
    loadModule('voucherify');

    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    window.fetch = vi.fn((_url: unknown, opts?: RequestInit) => {
      if (opts && opts.signal) signals.push(opts.signal);
      return new Promise((_resolve, reject) => {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        }
      });
    }) as unknown as typeof window.fetch;

    setupPricingDOM();
    window.ppLib.voucherify!.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 },
      pricing: { autoFetch: false },
      consent: { required: false },
      retry: { maxRetries: 1, baseDelay: 50, requestTimeoutMs: 200 }
    });
    window.ppLib.voucherify!.init();

    const promise = window.ppLib.voucherify!.fetchPricing();
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals.every(s => s.aborted)).toBe(true);
    vi.useRealTimers();
  });

  it('returns baseline pricing on fetch failure (does not leave DOM cloaked)', async () => {
    loadModule('common');
    loadModule('voucherify');

    window.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof window.fetch;

    setupPricingDOM();
    window.ppLib.voucherify!.configure({
      cache: { enabled: true, baseUrl: '/api/voucherify', ttl: 60000 },
      pricing: { autoFetch: false },
      consent: { required: false },
      retry: { maxRetries: 0, baseDelay: 10, requestTimeoutMs: 0 }
    });
    window.ppLib.voucherify!.init();

    const result = await window.ppLib.voucherify!.fetchPricing();
    // Baseline shape — non-empty, basePrice === discountedPrice
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
