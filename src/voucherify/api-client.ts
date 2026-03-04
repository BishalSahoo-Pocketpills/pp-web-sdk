import type { PPLib } from '../types/common.types';
import type { VoucherifyConfig } from '../types/voucherify.types';

export function createApiClient(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: VoucherifyConfig
) {
  var memCache: Map<string, { data: any; timestamp: number }> = new Map();

  function getCacheKey(endpoint: string, body: any): string {
    try {
      return endpoint + ':' + JSON.stringify(body);
    /*! v8 ignore start */
    } catch (e) {
      return endpoint + ':' + String(Date.now());
    }
    /*! v8 ignore stop */
  }

  function isCacheValid(key: string): boolean {
    var entry = memCache.get(key);
    if (!entry) return false;
    return (Date.now() - entry.timestamp) < CONFIG.cache.ttl;
  }

  async function request(endpoint: string, body: any): Promise<any> {
    var cacheKey = getCacheKey(endpoint, body);

    if (isCacheValid(cacheKey)) {
      ppLib.log('info', '[ppVoucherify] Cache hit for ' + endpoint);
      return memCache.get(cacheKey)!.data;
    }

    var response: Response;

    if (CONFIG.cache.enabled) {
      if (!CONFIG.cache.baseUrl) {
        throw new Error('Voucherify cache.baseUrl is not configured');
      }
      response = await win.fetch(CONFIG.cache.baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      if (!CONFIG.api.applicationId || !CONFIG.api.clientSecretKey) {
        throw new Error('Voucherify API credentials missing: ' +
          (!CONFIG.api.applicationId ? 'applicationId ' : '') +
          (!CONFIG.api.clientSecretKey ? 'clientSecretKey' : ''));
      }
      /*! v8 ignore start */
      var origin = CONFIG.api.origin || win.location.origin;
      /*! v8 ignore stop */
      response = await win.fetch(CONFIG.api.baseUrl + '/client/v1' + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Application-Id': CONFIG.api.applicationId,
          'X-Client-Token': CONFIG.api.clientSecretKey,
          'origin': origin
        },
        body: JSON.stringify(body)
      });
    }

    if (!response.ok) {
      throw new Error('Voucherify ' + endpoint + ': ' + response.status);
    }

    var data = await response.json();

    memCache.set(cacheKey, { data: data, timestamp: Date.now() });

    // Evict stale entries when cache exceeds 50 entries to prevent unbounded growth
    if (memCache.size > 50) {
      var pruneTime = Date.now();
      memCache.forEach(function(entry, key) {
        if ((pruneTime - entry.timestamp) >= CONFIG.cache.ttl) {
          memCache.delete(key);
        }
      });
    }

    return data;
  }

  async function qualifications(context: any): Promise<any> {
    return request('/qualifications', context);
  }

  async function validations(context: any): Promise<any> {
    return request('/validations', context);
  }

  function clearCache(): void {
    memCache.clear();
  }

  return {
    qualifications: qualifications,
    validations: validations,
    clearCache: clearCache
  };
}
