import type { PPLibConfig, SafeUtils, Security, SecurityJson } from '@src/types/common.types';

// Hostnames are case-insensitive per RFC 3986. URL spec parsers lowercase
// on parse, but allowlist ENTRIES come from caller config and may be in any
// case; we normalize both sides before compare so `['POCKETPILLS.COM']`
// configures correctly. Also strips a single trailing dot — FQDN form
// (`pocketpills.com.`) would otherwise miss a non-FQDN allowlist entry.
function normalizeHostname(host: string): string {
  let h = host.toLowerCase();
  if (h.length > 0 && h.charAt(h.length - 1) === '.') {
    h = h.substring(0, h.length - 1);
  }
  return h;
}

// Allowlist entries that are too-broad (`'com'`, `'co.uk'`, single-label)
// would silently grant trust to most of the internet via the dot-prefix
// suffix check. These reject early. The list is not exhaustive — bare TLDs
// follow many forms — but it catches the common misconfiguration patterns.
const KNOWN_TOO_BROAD_ENTRIES: Record<string, true> = {
  com: true, net: true, org: true, io: true, co: true, dev: true, app: true,
  ca: true, uk: true, us: true, au: true, de: true, fr: true,
  'co.uk': true, 'co.in': true, 'com.au': true, 'co.jp': true
};

function isAllowlistEntrySafe(entry: string): boolean {
  if (!entry || entry.indexOf('.') === -1) return false;
  if (KNOWN_TOO_BROAD_ENTRIES[entry]) return false;
  return true;
}

// Load-bearing security primitive: matches a host against an allowlist
// entry as either an exact match OR as a subdomain via the `.` + entry
// suffix. The dot prefix is REQUIRED — a bare suffix check would let
// `evilpocketpills.com` match `pocketpills.com`.
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith('.' + allowed);
}

export function createSecurity(
  config: PPLibConfig,
  safeUtils: SafeUtils,
  log: (level: import('@src/types/common.types').LogLevel, message: string, data?: unknown) => void,
  win: Window & typeof globalThis
): Security {
  // Single source of truth for "is this URL well-formed and within our
  // safety budget?" Used by both `isValidUrl` (no base) and
  // `isSafeRedirectUrl` (resolves against the current origin so relative
  // paths normalize naturally). Returns the parsed URL on success, null
  // on any failure — never throws.
  function parseAndValidateUrl(url: string, base?: string): URL | null {
    try {
      if (!url || typeof url !== 'string') return null;
      if (url.length > config.security.maxUrlLength) return null;
      const parsed = new URL(url, base);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (parsed.href.length > config.security.maxUrlLength) return null;
      return parsed;
    } catch (e) {
      log('verbose', 'parseAndValidateUrl error', e);
      return null;
    }
  }
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
      const result = parseAndValidateUrl(url);
      return result !== null;
    },

    isSafeRedirectUrl(url: string, allowedHosts?: string[]): boolean {
      try {
        // Resolve against current origin so relative paths normalize to
        // same-origin (always safe) and a bare `/app` need not be a special
        // case. `parseAndValidateUrl` enforces the same hardening as
        // `isValidUrl` (string + http(s) + length cap), shared so the two
        // public methods can't drift.
        const parsed = parseAndValidateUrl(url, win.location.href);
        if (!parsed) return false;

        if (parsed.origin === win.location.origin) return true;

        if (allowedHosts && allowedHosts.length) {
          // Hostname is normalized once: lowercased (URL spec already
          // lowercases on parse but we belt-and-suspenders for safety) and
          // trailing-dot-stripped (FQDN form `host.` would otherwise miss).
          const host = normalizeHostname(parsed.hostname);
          for (let i = 0; i < allowedHosts.length; i++) {
            const raw = allowedHosts[i];
            if (!raw || typeof raw !== 'string') continue;
            const allowed = normalizeHostname(raw);
            // Reject too-broad entries that would silently allow most of
            // the internet (e.g. `'com'`, `'co.uk'`). Any entry without a
            // dot OR matching a known eTLD should never be trusted as a
            // unilateral allowlist; emit a warn and skip the entry rather
            // than silently honour it.
            if (!isAllowlistEntrySafe(allowed)) {
              log('warn', '[ppLib] ignoring unsafe allowlist entry: ' + allowed);
              continue;
            }
            // The `'.' + allowed` prefix is load-bearing: a bare suffix
            // check would let `evilpocketpills.com` match `pocketpills.com`.
            if (hostMatches(host, allowed)) return true;
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
          if (obj === null || obj === undefined) return null;

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
        if (data === null || data === undefined) return false;
        if (typeof data !== 'object') return true;

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
