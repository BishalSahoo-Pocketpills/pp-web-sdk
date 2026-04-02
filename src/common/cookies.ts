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
