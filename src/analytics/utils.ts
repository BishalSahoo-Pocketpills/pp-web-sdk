import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig } from '@src/types/analytics.types';

export type LogLevel = 'info' | 'warn' | 'error' | 'verbose' | 'log';

export interface AnalyticsUtils {
  log: (level: LogLevel, message: string, data?: unknown) => void;
  getAllParamNames: () => string[];
  resetParamCache: () => void;
  isValidParam: (name: string) => boolean;
}

export function createAnalyticsUtils(CONFIG: AnalyticsConfig, ppLib: PPLib): AnalyticsUtils {
  const SafeUtils = ppLib.SafeUtils;
  let cachedParamNames: string[] | null = null;

  function getAllParamNames(): string[] {
    try {
      /*! v8 ignore start */
      if (cachedParamNames) return cachedParamNames;
      /*! v8 ignore stop */

      /*! v8 ignore start */
      let params = (CONFIG.parameters.utm || []).slice();
      /*! v8 ignore stop */

      /*! v8 ignore start */
      const ads: Record<string, string[]> = (CONFIG.parameters.ads || {}) as unknown as Record<string, string[]>;
      /*! v8 ignore stop */
      for (const platform in ads) {
        /*! v8 ignore start */
        if (Object.prototype.hasOwnProperty.call(ads, platform) && Array.isArray(ads[platform])) {
        /*! v8 ignore stop */
          params = params.concat(ads[platform]);
        }
      }

      /*! v8 ignore start */
      params = params.concat(CONFIG.parameters.custom || []);
      /*! v8 ignore stop */
      cachedParamNames = params;
      return params;
    } catch (e) {
      ppLib.log('error', 'getAllParamNames error', ppLib.safeLogError(e));
      return [];
    }
  }

  /*! v8 ignore start */
  function log(level: LogLevel, message: string, data?: unknown): void {
    if (!CONFIG.debug) return;
    if (level === 'verbose' && !CONFIG.verbose) return;

    try {
      const prefix = '[ppAnalytics v' + CONFIG.version + ']';
      const consoleObj = console as unknown as Record<string, ((...args: unknown[]) => void) | undefined>;
      const logFn = consoleObj[level] || console.log;
      logFn.call(console, prefix, message, data || '');
    } catch (e) {
      // Silent fail for logging
    }
  }
  /*! v8 ignore stop */

  /*! v8 ignore start */
  function isValidParam(name: string): boolean {
    try {
      if (!SafeUtils.exists(name)) return false;
      const whitelist = getAllParamNames();
      return whitelist.indexOf(name) !== -1;
    } catch (e) {
      return false;
    }
  }
  /*! v8 ignore stop */

  function resetParamCache(): void {
    cachedParamNames = null;
  }

  return {
    log: log,
    getAllParamNames: getAllParamNames,
    resetParamCache: resetParamCache,
    isValidParam: isValidParam
  };
}
