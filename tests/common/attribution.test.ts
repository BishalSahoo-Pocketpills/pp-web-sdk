/**
 * Unit tests for the shared marketing attribution service.
 *
 * Focus areas:
 *  - TouchAttribution schema: full-URL referrer + referrerDomain hostname +
 *    full-URL landingPage (data-team contract for 1C).
 *  - Storage migration from legacy localStorage `mktg_*` keys to the
 *    cross-subdomain `pp_mktg_*_touch` cookies (1C, mirroring 1B).
 *  - Platform classifier still uses the 'direct' / 'internal' / hostname
 *    label space — disentangled from the user-facing referrer field.
 */
import { createAttributionService } from '../../src/common/attribution';
import { createSetCookie, createDeleteCookie } from '../../src/common/cookies';
import type { PPLib } from '../../src/types/common.types';

function makePPLib(opts?: { cookies?: Record<string, string> }): PPLib {
  const cookies = opts?.cookies || {};
  const log = vi.fn();
  const getCookieReal = (name: string): string | null => {
    if (Object.prototype.hasOwnProperty.call(cookies, name)) return cookies[name];
    try {
      if (!name || !document.cookie) return null;
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : null;
    } catch (e) { return null; }
  };
  const ppLib: any = {
    config: { cookieDomain: undefined },
    getCookie: vi.fn(getCookieReal),
    setCookie: createSetCookie(document, window, log),
    deleteCookie: createDeleteCookie(document, window, log),
    Storage: {
      get: vi.fn((_k: string) => null),
      set: vi.fn(),
      remove: vi.fn(),
    },
    Security: { sanitize: (v: string) => v },
    log,
  };
  return ppLib as PPLib;
}

function setHref(href: string): void {
  // jsdom won't accept arbitrary location reassignment; replace the
  // location object with one that mirrors the URL surface buildTouch reads.
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    value: {
      href: href,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
    },
    writable: true,
    configurable: true,
  });
}

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', {
    value: value,
    writable: true,
    configurable: true,
  });
}

function clearAllCookies(): void {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
}

describe('createAttributionService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAllCookies();
    setHref('http://localhost/landing');
    setReferrer('');
  });

  describe('TouchAttribution schema (1C)', () => {
    it('stores the FULL referrer URL, not a classifier label', () => {
      setReferrer('https://www.google.com/search?q=pocketpills');
      setHref('http://localhost/lp/x?utm_source=google&utm_medium=cpc');

      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current).not.toBeNull();
      expect(current!.referrer).toBe('https://www.google.com/search?q=pocketpills');
      expect(current!.referrerDomain).toBe('www.google.com');
    });

    it('uses empty string for both referrer fields on direct visits', () => {
      setReferrer('');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current!.referrer).toBe('');
      expect(current!.referrerDomain).toBe('');
    });

    it('returns empty referrerDomain on unparseable referrer (defensive)', () => {
      // jsdom's URL constructor rejects malformed strings — but
      // document.referrer is browser-set and normally a valid URL. The
      // try/catch is the safety net.
      setReferrer('not a url');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current!.referrer).toBe('not a url');
      expect(current!.referrerDomain).toBe('');
    });

    it('stores the full landing URL (href with query), not just pathname', () => {
      setHref('http://localhost/lp/spring?utm_source=fb&utm_medium=social&promo=abc');

      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current!.landingPage).toBe('http://localhost/lp/spring?utm_source=fb&utm_medium=social&promo=abc');
    });
  });

  describe('platform classifier (regression: still uses label space)', () => {
    it('detects organic_search via google referrer hostname', () => {
      setReferrer('https://www.google.com/search?q=foo');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current!.platform).toBe('organic_search');
    });

    it('detects organic_social via facebook referrer', () => {
      setReferrer('https://www.facebook.com/');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      expect(svc.getCurrent()!.platform).toBe('organic_social');
    });

    it('classifies same-origin referrer as direct (not "internal" leakage)', () => {
      setHref('http://localhost/page');
      setReferrer('http://localhost/other');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      // Internal referrers don't hit any organic-domain branch and have no
      // UTM, so platform falls through to 'direct'.
      expect(svc.getCurrent()!.platform).toBe('direct');
    });

    it('falls back to direct when document.referrer is empty', () => {
      setReferrer('');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      expect(svc.getCurrent()!.platform).toBe('direct');
    });
  });
});
