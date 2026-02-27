import type { PPLibConfig, SafeUtils, Security } from '../types/common.types';

export function createSecurity(
  config: PPLibConfig,
  safeUtils: SafeUtils,
  log: (level: string, message: string, data?: any) => void
): Security {
  return {
    sanitize(input: any): string {
      try {
        if (!config.security.enableSanitization) return safeUtils.toString(input);
        if (!safeUtils.exists(input)) return '';

        const str = safeUtils.toString(input);

        const sanitized = str
          .replace(/[<>'"]/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .replace(/[\x00-\x1F\x7F]/g, '')
          .replace(/data:text\/html/gi, '')
          .substring(0, config.security.maxParamLength);

        if (config.security.strictMode && sanitized !== str.substring(0, config.security.maxParamLength)) {
          log('warn', 'Rejected suspicious input');
          return '';
        }

        return sanitized;
      } catch (e) {
        log('error', 'Sanitize error', e);
        return '';
      }
    },

    isValidUrl(url: string): boolean {
      try {
        if (!url || typeof url !== 'string') return false;
        if (url.length > config.security.maxUrlLength) return false;

        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (e) {
        return false;
      }
    },

    json: {
      parse(str: string, fallback?: any): any {
        try {
          if (!safeUtils.exists(str)) return fallback || null;

          const parsed = JSON.parse(str);
          const stringified = JSON.stringify(parsed);

          if (stringified.length > config.security.maxStorageSize) {
            log('error', 'Data exceeds size limit');
            return fallback || null;
          }

          return parsed;
        } catch (e) {
          log('verbose', 'JSON parse error', e);
          return fallback || null;
        }
      },

      stringify(obj: any): string | null {
        try {
          if (!obj) return null;

          const str = JSON.stringify(obj);

          if (str.length > config.security.maxStorageSize) {
            log('error', 'Data too large to stringify');
            return null;
          }

          return str;
        } catch (e) {
          log('error', 'JSON stringify error', e);
          return null;
        }
      }
    },

    validateData(data: any): boolean {
      try {
        if (!data || typeof data !== 'object') return false;

        const jsonStr = JSON.stringify(data);
        const dangerousPatterns = [
          /<script/i,
          /javascript:/i,
          /on\w+=/i,
          /eval\(/i,
          /expression\(/i,
          /data:text\/html/i
        ];

        for (let i = 0; i < dangerousPatterns.length; i++) {
          if (dangerousPatterns[i].test(jsonStr)) {
            log('error', 'Dangerous pattern detected');
            return false;
          }
        }

        return true;
      } catch (e) {
        return false;
      }
    }
  };
}
