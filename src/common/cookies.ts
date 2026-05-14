import type { PPLib } from '@src/types/common.types';

export function createGetCookie(doc: Document): (name: string) => string | null {
  return function getCookie(name: string): string | null {
    try {
      if (!name || !doc.cookie) return null;

      const match = doc.cookie.match(new RegExp('(^| )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]+)'));
      if (match) return decodeURIComponent(match[2]);
      return null;
    } catch (e) {
      return null;
    }
  };
}

export function createDeleteCookie(
  doc: Document,
  win: Window & typeof globalThis,
  log: PPLib['log']
): (name: string) => void {
  return function deleteCookie(name: string): void {
    try {
      if (!name) return;
      doc.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      doc.cookie = name + '=; Path=' + win.location.pathname + '; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    } catch (e) {
      log('error', 'deleteCookie error', e);
    }
  };
}

export interface SetCookieOptions {
  /** e.g. '.pocketpills.com'. Skipped if the current hostname doesn't end with the domain root (dev/test safety). */
  domain?: string;
  /** Defaults to '/'. */
  path?: string;
  /** Omit for a session cookie. */
  maxAgeSeconds?: number;
  /** Defaults to 'Lax'. */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Auto-derived from `win.location.protocol === 'https:'` when omitted. */
  secure?: boolean;
}

export function createSetCookie(
  doc: Document,
  win: Window & typeof globalThis,
  log: PPLib['log']
): (name: string, value: string, options?: SetCookieOptions) => void {
  return function setCookie(name: string, value: string, options?: SetCookieOptions): void {
    try {
      if (!name) return;
      // Reject CR/LF/NUL in cookie name OR an option string (Domain, Path,
      // SameSite). Header-injection on `document.cookie` is technically the
      // browser's problem to prevent, but defending in JS keeps this helper
      // safe even when callers pass tainted input (e.g. a future API ever
      // accepts a user-supplied cookie name).
      if (/[\r\n\0]/.test(name)) {
        log('error', 'setCookie: cookie name contains forbidden control characters');
        return;
      }
      const opts = options || {};
      if (opts.domain && /[\r\n\0;]/.test(opts.domain)) {
        log('error', 'setCookie: cookie domain contains forbidden characters');
        return;
      }
      if (opts.path && /[\r\n\0;]/.test(opts.path)) {
        log('error', 'setCookie: cookie path contains forbidden characters');
        return;
      }
      const encoded = encodeURIComponent(value == null ? '' : String(value));

      let str = name + '=' + encoded;

      // Domain: skip when hostname doesn't end with the configured root.
      // This prevents bad cookie writes in dev (localhost) / test (jsdom)
      // that would set a cookie the browser silently rejects.
      if (opts.domain) {
        const hostname = win.location && win.location.hostname ? win.location.hostname : '';
        const root = opts.domain.charAt(0) === '.' ? opts.domain.slice(1) : opts.domain;
        if (hostname === root || hostname.endsWith('.' + root)) {
          str += '; Domain=' + opts.domain;
        }
      }

      str += '; Path=' + (opts.path || '/');

      if (typeof opts.maxAgeSeconds === 'number' && isFinite(opts.maxAgeSeconds)) {
        str += '; Max-Age=' + Math.floor(opts.maxAgeSeconds);
      }

      str += '; SameSite=' + (opts.sameSite || 'Lax');

      const secure = typeof opts.secure === 'boolean'
        ? opts.secure
        : (win.location && win.location.protocol === 'https:');
      if (secure) str += '; Secure';

      doc.cookie = str;
    } catch (e) {
      log('error', 'setCookie error', e);
    }
  };
}
