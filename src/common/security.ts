import type { PPLibConfig, SafeUtils, Security, SecurityJson } from '@src/types/common.types';

export function createSecurity(
  config: PPLibConfig,
  safeUtils: SafeUtils,
  log: (level: string, message: string, data?: unknown) => void,
  win: Window & typeof globalThis
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

  // Single implementation backs all SecurityJson.parse overloads; we cast
  // the json literal to the interface type below so TypeScript accepts the
  // overload-vs-impl asymmetry inside an object literal.
  return {
    sanitize(input: unknown): string {
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

    isSafeRedirectUrl(url: string, allowedHosts?: string[]): boolean {
      try {
        // Reuse isValidUrl's hardening — rejects empty/oversize/non-http(s)/
        // unparseable, which covers javascript:, data:, file:, ftp:, etc.
        // We hand it the absolute form so a bare relative path like `/app`
        // still passes via the same-origin branch below.
        if (!url || typeof url !== 'string') return false;

        // Resolve against current origin so relative paths normalize naturally.
        const base = win.location.href;
        const parsed = new URL(url, base);

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return false;
        }
        if (parsed.href.length > config.security.maxUrlLength) return false;

        if (parsed.origin === win.location.origin) return true;

        if (allowedHosts && allowedHosts.length) {
          const host = parsed.hostname;
          for (let i = 0; i < allowedHosts.length; i++) {
            const allowed = allowedHosts[i];
            if (!allowed || typeof allowed !== 'string') continue;
            // The `'.' + allowed` prefix is load-bearing: a bare suffix
            // check would let `evilpocketpills.com` match `pocketpills.com`.
            if (host === allowed || host.endsWith('.' + allowed)) return true;
          }
        }

        log('warn', '[ppLib] blocked cross-origin redirect: ' + parsed.hostname);
        return false;
      } catch (e) {
        log('verbose', 'isSafeRedirectUrl parse error', e);
        return false;
      }
    },

    // Implementation function backs all parse overloads; cast to SecurityJson
    // because TypeScript can't reconcile a single impl signature against
    // multiple call signatures inside an object literal.
    json: {
      parse(str: string, fallback?: unknown): unknown {
        try {
          if (!safeUtils.exists(str)) return fallback === undefined ? null : fallback;

          const parsed = JSON.parse(str);
          const stringified = JSON.stringify(parsed);

          if (stringified.length > config.security.maxStorageSize) {
            log('error', 'Data exceeds size limit');
            return fallback === undefined ? null : fallback;
          }

          return parsed;
        } catch (e) {
          log('verbose', 'JSON parse error', e);
          return fallback === undefined ? null : fallback;
        }
      },

      stringify(obj: unknown): string | null {
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
    } as SecurityJson,

    validateData(data: unknown): boolean {
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
