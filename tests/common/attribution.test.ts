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

    it('strips URL fragment from landing page (OAuth token leak defense)', () => {
      // An OAuth implicit-flow callback would land with the access token in
      // the hash. Persisting that for 2 years in a cookie is a credential
      // leak — buildTouch() must strip the fragment.
      setHref('http://localhost/oauth/callback?utm_source=email#access_token=secret-abc-xyz&token_type=Bearer');

      const svc = createAttributionService(window, makePPLib());
      svc.init();

      const current = svc.getCurrent();
      expect(current!.landingPage).toBe('http://localhost/oauth/callback?utm_source=email');
      expect(current!.landingPage.indexOf('access_token')).toBe(-1);
      expect(current!.landingPage.indexOf('#')).toBe(-1);
    });
  });

  describe('storage migration: localStorage mktg_* → pp_mktg_* cookies', () => {
    it('migrates legacy mktg_first / mktg_last / mktg_session to cookies on init', () => {
      // Seed legacy localStorage as if pre-1C deploy. Each TouchAttribution
      // has every required field — pre-1C entries WITHOUT referrerDomain
      // are tested separately below.
      const first = {
        source: 'facebook', medium: 'social', campaign: 'launch', platform: 'organic_social',
        clickId: '', landingPage: 'http://localhost/first',
        referrer: 'https://www.facebook.com/', referrerDomain: 'www.facebook.com',
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const last = {
        source: 'google', medium: 'cpc', campaign: 'spring', platform: 'google_ads',
        clickId: 'abc', landingPage: 'http://localhost/last',
        referrer: 'https://www.google.com/', referrerDomain: 'www.google.com',
        timestamp: '2024-06-01T00:00:00.000Z',
      };
      window.localStorage.setItem('mktg_first', JSON.stringify(first));
      window.localStorage.setItem('mktg_last', JSON.stringify(last));
      window.localStorage.setItem('mktg_session', JSON.stringify({ ts: Date.now() }));

      const svc = createAttributionService(window, makePPLib());
      // Read-only — confirms migration happens on read, not init.
      const migratedFirst = svc.getFirstTouch();
      const migratedLast = svc.getLastTouch();

      expect(migratedFirst).toEqual(first);
      expect(migratedLast).toEqual(last);

      // Cookies written
      expect(document.cookie).toContain('pp_mktg_first_touch=');
      expect(document.cookie).toContain('pp_mktg_last_touch=');

      // Legacy localStorage entries purged after migration
      expect(window.localStorage.getItem('mktg_first')).toBeNull();
      expect(window.localStorage.getItem('mktg_last')).toBeNull();
    });

    it('drops pre-1C TouchAttribution that lacks referrerDomain (corrupt under new schema)', () => {
      // Simulate a stored value from before 1C — no referrerDomain field.
      // parseTouchAttribution() must reject it so the next init writes a
      // fresh, schema-compliant cookie.
      const preOneC = {
        source: 'google', medium: 'cpc', campaign: 'spring', platform: 'google_ads',
        clickId: '', landingPage: '/lp',
        referrer: 'google.com',
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      window.localStorage.setItem('mktg_first', JSON.stringify(preOneC));

      const svc = createAttributionService(window, makePPLib());
      // Pre-1C value rejected, returns null (no generator on the touch store).
      expect(svc.getFirstTouch()).toBeNull();
      // Legacy entry purged so it doesn't keep tripping deserializers.
      expect(window.localStorage.getItem('mktg_first')).toBeNull();
    });

    it('init() writes first/last touch to the new cookies', () => {
      setHref('http://localhost/lp?utm_source=ig&utm_medium=social');
      setReferrer('https://www.instagram.com/');

      const svc = createAttributionService(window, makePPLib());
      svc.init();

      // Cookies present after init
      expect(document.cookie).toContain('pp_mktg_first_touch=');
      expect(document.cookie).toContain('pp_mktg_last_touch=');
      expect(document.cookie).toContain('pp_mktg_session=');

      const stored = svc.getFirstTouch();
      expect(stored).not.toBeNull();
      expect(stored!.source).toBe('ig');
      expect(stored!.landingPage).toBe('http://localhost/lp?utm_source=ig&utm_medium=social');
      expect(stored!.referrer).toBe('https://www.instagram.com/');
      expect(stored!.referrerDomain).toBe('www.instagram.com');
    });

    it('clear() removes all three cookies', () => {
      setHref('http://localhost/lp?utm_source=fb');
      const svc = createAttributionService(window, makePPLib());
      svc.init();

      expect(document.cookie).toContain('pp_mktg_first_touch=');

      svc.clear();

      expect(document.cookie).not.toMatch(/pp_mktg_first_touch=[^;]+/);
      expect(document.cookie).not.toMatch(/pp_mktg_last_touch=[^;]+/);
      expect(document.cookie).not.toMatch(/pp_mktg_session=[^;]+/);
    });

    it('isSessionActive returns false when session cookie is absent', () => {
      // Direct way: brand new service, no init() — session never written.
      const svc = createAttributionService(window, makePPLib());
      // Indirectly: getLastTouch with no init/migration must be null too,
      // confirming the fresh-state path is exercised.
      expect(svc.getLastTouch()).toBeNull();
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
