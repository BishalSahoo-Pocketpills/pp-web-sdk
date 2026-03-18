import type { PPLibConfig, SafeUtils, Security } from '../types/common.types';

export function createSecurity(
  config: PPLibConfig,
  safeUtils: SafeUtils,
  log: (level: string, message: string, data?: any) => void
): Security {
  // Precompiled regex constants — avoids recompilation on every call
  const SPECIAL_CHARS_RE = /[<>'"]/g;
  const JAVASCRIPT_URI_RE = /javascript:/gi;
  const EVENT_HANDLER_RE = /\bon(abort|blur|change|click|close|contextmenu|copy|cut|dblclick|drag|dragend|dragenter|dragleave|dragover|dragstart|drop|error|focus|focusin|focusout|hashchange|input|invalid|keydown|keypress|keyup|load|message|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|paste|pointerdown|pointerenter|pointerleave|pointermove|pointerout|pointerover|pointerup|reset|resize|scroll|select|submit|touchcancel|touchend|touchmove|touchstart|unload|wheel)\s*=/gi;
  const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;
  const DATA_URI_RE = /data:text\/html/gi;
  const SCRIPT_RE = /<script/i;
  const EVAL_RE = /eval\(/i;
  const EXPRESSION_RE = /expression\(/i;

  return {
    sanitize(input: any): string {
      try {
        if (!config.security.enableSanitization) return safeUtils.toString(input);
        if (!safeUtils.exists(input)) return '';

        const str = safeUtils.toString(input);

        const sanitized = str
          .replace(SPECIAL_CHARS_RE, '')
          .replace(JAVASCRIPT_URI_RE, '')
          .replace(EVENT_HANDLER_RE, '')
          .replace(CONTROL_CHARS_RE, '')
          .replace(DATA_URI_RE, '')
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
        log('verbose', 'isValidUrl parse error', e);
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
          SCRIPT_RE,
          JAVASCRIPT_URI_RE,
          EVENT_HANDLER_RE,
          EVAL_RE,
          EXPRESSION_RE,
          DATA_URI_RE
        ];

        for (let i = 0; i < dangerousPatterns.length; i++) {
          dangerousPatterns[i].lastIndex = 0;
          if (dangerousPatterns[i].test(jsonStr)) {
            log('error', 'Dangerous pattern detected');
            return false;
          }
        }

        return true;
      } catch (e) {
        log('verbose', 'validateData error', e);
        return false;
      }
    }
  };
}
