/**
 * Voucherify API client.
 *
 * Wraps the HTTP layer (fetch + AbortController per attempt) and the
 * in-memory response cache. Three transport modes are supported via
 * config:
 *
 *   - **Browser-direct**: send to Voucherify's public API with a public
 *     client token. Refuses to run if a `clientSecretKey` is configured
 *     (defense-in-depth — init() already hard-blocks this, but
 *     apiRequest() re-checks at call time so a runtime config override
 *     still fails safe).
 *
 *   - **Cache (proxy) mode**: send to a customer-hosted proxy at
 *     `cache.baseUrl`. The proxy terminates Voucherify auth server-side.
 *
 *   - **Edge mode**: handled by callers (pp-pricing-worker integration);
 *     this client is not invoked.
 *
 * Cache eviction is currently TTL-based on every write when the map
 * exceeds 50 entries. Sprint 2 hard-caps this with LRU semantics.
 */

import type { PPLib } from '@src/types/common.types';
import type {
  VoucherifyConfig,
  QualificationContext,
  ValidationContext,
  VoucherifyApiResponse,
} from '@src/types/voucherify.types';
import { VoucherifyConfigError, VoucherifyApiError } from '@src/voucherify/errors';
import { withRetryAsync } from '@src/common/retry';

/** Soft threshold — TTL-based prune fires when the cache grows past this. */
const CACHE_TTL_PRUNE_THRESHOLD = 50;
/** Hard cap — never let the cache exceed this many entries. LRU evicts. */
const CACHE_HARD_CAP = 250;

export interface VoucherifyApiClient {
  apiQualifications: (
    context: QualificationContext | Record<string, unknown>,
  ) => Promise<VoucherifyApiResponse>;
  apiValidations: (
    context: ValidationContext | Record<string, unknown>,
  ) => Promise<VoucherifyApiResponse>;
  apiRequest: (
    endpoint: string,
    body: QualificationContext | ValidationContext | Record<string, unknown>,
  ) => Promise<VoucherifyApiResponse>;
  /**
   * Raw retry-aware fetch — exposed for edge-mode call sites that bypass
   * the auth + cache layer (offers / pricing GETs against the edge worker).
   * Returns the Response object as-is so callers can inspect status before
   * parsing the body.
   */
  fetchWithRetry: (url: string, options: RequestInit) => Promise<Response>;
  clearCache: () => void;
  /**
   * Visible for testing — lets callers inspect cache state without poking
   * at internals.
   */
  _cacheSize: () => number;
}

export function createVoucherifyApiClient(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig,
): VoucherifyApiClient {
  const memCache: Map<string, { data: unknown; timestamp: number }> = new Map();

  function getCacheKey(endpoint: string, body: unknown): string {
    try {
      return endpoint + ':' + JSON.stringify(body);
      /*! v8 ignore start — JSON.stringify circular-ref throw is not reachable in normal usage */
    } catch (e) {
      return endpoint + ':' + String(Date.now());
    }
    /*! v8 ignore stop */
  }

  function isCacheValid(key: string): boolean {
    const entry = memCache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp >= CONFIG.cache.ttl) {
      memCache.delete(key);
      return false;
    }
    return true;
  }

  async function fetchOnce(url: string, options: RequestInit): Promise<Response> {
    const timeoutMs = CONFIG.retry.requestTimeoutMs;
    // Per-attempt AbortController so each retry gets its own deadline.
    // Browser default fetch timeouts are too long (Chrome ~5min, Safari
    // forever) — without this a stalled response blocks checkout.
    const controller = timeoutMs > 0 ? new win.AbortController() : null;
    const timer = controller
      ? win.setTimeout(function () {
          controller.abort();
        }, timeoutMs)
      : null;
    try {
      const reqOptions: RequestInit = controller
        ? { ...options, signal: controller.signal }
        : options;
      const response = await win.fetch(url, reqOptions);
      // 2xx and 4xx return as-is — callers inspect `response.status`.
      // Only 5xx throws so the retry HOF kicks in.
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      throw new Error('HTTP ' + response.status);
    } finally {
      if (timer !== null) win.clearTimeout(timer);
    }
  }

  function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    return withRetryAsync({
      fn: () => fetchOnce(url, options),
      // CONFIG.retry.maxRetries is the historical "extra attempts after
      // the first" — total attempts = maxRetries + 1.
      attempts: CONFIG.retry.maxRetries + 1,
      baseDelay: CONFIG.retry.baseDelay,
      win,
    });
  }

  async function apiRequest(
    endpoint: string,
    body: QualificationContext | ValidationContext | Record<string, unknown>,
  ): Promise<VoucherifyApiResponse> {
    const cacheKey = getCacheKey(endpoint, body);

    if (isCacheValid(cacheKey)) {
      ppLib.log('info', '[ppVoucherify] Cache hit for ' + endpoint);
      return memCache.get(cacheKey)!.data as VoucherifyApiResponse;
    }

    let apiResponse: Response;

    if (CONFIG.cache.enabled) {
      if (!CONFIG.cache.baseUrl) {
        throw new VoucherifyConfigError('cache.baseUrl is not configured', { endpoint });
      }
      apiResponse = await fetchWithRetry(CONFIG.cache.baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      if (!CONFIG.api.applicationId) {
        throw new VoucherifyConfigError('Voucherify API applicationId missing', { endpoint });
      }
      // Defense-in-depth: refuse to send the server-side secret from the
      // browser even if a runtime override slipped past init()'s guard.
      const browserToken = CONFIG.api.clientPublicKey;
      if (!browserToken) {
        if (CONFIG.api.clientSecretKey) {
          throw new VoucherifyConfigError(
            'clientSecretKey must not be sent from the browser; configure clientPublicKey, or use cache.enabled=true with a proxy, or edge.mode="edge".',
            { endpoint },
          );
        }
        throw new VoucherifyConfigError('Voucherify clientPublicKey missing', { endpoint });
      }
      /*! v8 ignore start — jsdom location.origin is always http://localhost */
      const origin = CONFIG.api.origin || win.location.origin;
      /*! v8 ignore stop */
      apiResponse = await fetchWithRetry(CONFIG.api.baseUrl + '/client/v1' + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Application-Id': CONFIG.api.applicationId,
          'X-Client-Token': browserToken,
          origin: origin,
        },
        body: JSON.stringify(body),
      });
    }

    if (!apiResponse.ok) {
      throw new VoucherifyApiError('Voucherify API non-OK', {
        endpoint,
        status: apiResponse.status,
      });
    }

    const data = await apiResponse.json();

    memCache.set(cacheKey, { data: data, timestamp: Date.now() });

    // Two-stage eviction:
    //   1. Soft prune: when the cache passes CACHE_TTL_PRUNE_THRESHOLD,
    //      drop everything past its TTL. Cheap, bounded scan.
    //   2. Hard cap: if the cache is still above CACHE_HARD_CAP (e.g. lots
    //      of fresh non-expired entries during a heavy fetch burst), evict
    //      the oldest entries in insertion order. Map preserves insertion
    //      order, so iterating yields LRU on the write axis.
    if (memCache.size > CACHE_TTL_PRUNE_THRESHOLD) {
      const pruneTime = Date.now();
      memCache.forEach(function (entry, key) {
        if (pruneTime - entry.timestamp >= CONFIG.cache.ttl) {
          memCache.delete(key);
        }
      });
    }
    if (memCache.size > CACHE_HARD_CAP) {
      const overflow = memCache.size - CACHE_HARD_CAP;
      const keysIter = memCache.keys();
      for (let i = 0; i < overflow; i++) {
        const k = keysIter.next();
        if (k.done) break;
        memCache.delete(k.value);
      }
    }

    return data;
  }

  return {
    apiQualifications(context) {
      return apiRequest('/qualifications', context);
    },
    apiValidations(context) {
      return apiRequest('/validations', context);
    },
    apiRequest,
    fetchWithRetry,
    clearCache() {
      memCache.clear();
    },
    _cacheSize() {
      return memCache.size;
    },
  };
}
