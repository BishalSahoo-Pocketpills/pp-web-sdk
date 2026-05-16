/**
 * Unit tests for the cross-subdomain PersistentValue factory.
 *
 * Covers the read precedence ladder (cookie → legacy localStorage migration
 * → generate), JSON round-trip, write encoding, and clear semantics.
 */
import { createPersistentValue } from '../../src/common/persistent-storage';
import { createGetCookie, createDeleteCookie, createSetCookie } from '../../src/common/cookies';
import type { PPLib } from '../../src/types/common.types';

function clearAllCookies(): void {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
}

function makePPLib(cookieDomain?: string): PPLib {
  const log = vi.fn();
  const ppLib: PPLib = {
    config: { debug: false, verbose: false, namespace: 'pp', security: {} as never, cookieDomain: cookieDomain },
    log,
    getCookie: createGetCookie(document),
    deleteCookie: createDeleteCookie(document, window, log),
    setCookie: createSetCookie(document, window, log),
  } as unknown as PPLib;
  return ppLib;
}

describe('createPersistentValue', () => {
  beforeEach(() => {
    clearAllCookies();
    localStorage.clear();
  });

  describe('read precedence', () => {
    it('returns the cookie value when present (cookie-first)', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_test=hello-from-cookie; path=/';
      // Also seed localStorage with a stale value to prove it loses
      localStorage.setItem('pv_test', 'stale-from-localstorage');

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_test',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s,
        legacyLocalStorageKey: 'pv_test'
      });

      expect(pv.read()).toBe('hello-from-cookie');
      // Cookie wins — legacy entry is left untouched (no migration triggered).
      expect(localStorage.getItem('pv_test')).toBe('stale-from-localstorage');
    });

    it('migrates a legacy localStorage value to cookie, then deletes the legacy entry', () => {
      const ppLib = makePPLib();
      localStorage.setItem('pv_mig', 'legacy-uuid');

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_mig',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s,
        legacyLocalStorageKey: 'pv_mig'
      });

      expect(pv.read()).toBe('legacy-uuid');
      // Cookie now seeded
      expect(ppLib.getCookie('pv_mig')).toBe('legacy-uuid');
      // Legacy localStorage entry purged
      expect(localStorage.getItem('pv_mig')).toBeNull();

      // Second read comes from cookie only — proves migration is one-shot.
      localStorage.setItem('pv_mig', 'should-be-ignored');
      expect(pv.read()).toBe('legacy-uuid');
    });

    it('falls through to generate() when neither cookie nor legacy storage has a value', () => {
      const ppLib = makePPLib();
      const generate = vi.fn(() => 'fresh-uuid');

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s,
        generate,
        legacyLocalStorageKey: 'pv_new'
      });

      expect(pv.read()).toBe('fresh-uuid');
      expect(generate).toHaveBeenCalledTimes(1);
      // Generated value should now be in the cookie
      expect(ppLib.getCookie('pv_new')).toBe('fresh-uuid');

      // Second read should NOT call generate again
      expect(pv.read()).toBe('fresh-uuid');
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('returns null when no generate fn is provided and the value is absent', () => {
      const ppLib = makePPLib();
      const pv = createPersistentValue<{ a: string }>(window, ppLib, {
        cookieName: 'pv_optional',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => {
          try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
        },
        legacyLocalStorageKey: 'pv_optional'
      });

      expect(pv.read()).toBeNull();
    });

    it('falls through to generate() when the cookie value fails to deserialize (self-heal)', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_corrupt=' + encodeURIComponent('{not json');
      const generate = vi.fn(() => ({ ok: true }));

      const pv = createPersistentValue<{ ok: boolean }>(window, ppLib, {
        cookieName: 'pv_corrupt',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => { try { return JSON.parse(raw); } catch (e) { return null; } },
        generate
      });

      expect(pv.read()).toEqual({ ok: true });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('drops a corrupted legacy localStorage value and falls through to generate', () => {
      const ppLib = makePPLib();
      localStorage.setItem('pv_badlegacy', 'garbage-{');
      const generate = vi.fn(() => ({ x: 1 }));

      const pv = createPersistentValue<{ x: number }>(window, ppLib, {
        cookieName: 'pv_badlegacy',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => { try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } },
        generate,
        legacyLocalStorageKey: 'pv_badlegacy'
      });

      expect(pv.read()).toEqual({ x: 1 });
      // Corrupted legacy key was purged so we don't keep retrying it.
      expect(localStorage.getItem('pv_badlegacy')).toBeNull();
    });
  });

  describe('write', () => {
    it('URL-encodes via setCookie and round-trips through read', () => {
      const ppLib = makePPLib();
      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_w',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s
      });

      pv.write('value with spaces & ampersands');
      expect(pv.read()).toBe('value with spaces & ampersands');
    });

    it('JSON-serializes structured values', () => {
      const ppLib = makePPLib();
      type Touch = { source: string; medium: string };
      const pv = createPersistentValue<Touch>(window, ppLib, {
        cookieName: 'pv_json',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => {
          try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o as Touch : null; }
          catch (e) { return null; }
        }
      });

      pv.write({ source: 'google', medium: 'cpc' });
      expect(pv.read()).toEqual({ source: 'google', medium: 'cpc' });
    });

    it('logs and swallows errors from a broken setCookie', () => {
      const log = vi.fn();
      const ppLib: PPLib = {
        config: { cookieDomain: undefined } as never,
        log,
        getCookie: () => null,
        deleteCookie: () => {},
        setCookie: () => { throw new Error('boom'); }
      } as unknown as PPLib;

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_e',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s
      });

      expect(() => pv.write('x')).not.toThrow();
      expect(log).toHaveBeenCalledWith('error', 'persistentValue.write error', expect.objectContaining({ cookieName: 'pv_e' }));
    });
  });

  describe('clear', () => {
    it('removes the cookie and the legacy localStorage key', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_c=alive; path=/';
      localStorage.setItem('pv_c', 'leftover');

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_c',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s,
        legacyLocalStorageKey: 'pv_c'
      });

      pv.clear();
      expect(ppLib.getCookie('pv_c')).toBeNull();
      expect(localStorage.getItem('pv_c')).toBeNull();
    });

    it('handles a missing legacyLocalStorageKey gracefully', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_d=alive; path=/';

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_d',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => s
      });

      expect(() => pv.clear()).not.toThrow();
      expect(ppLib.getCookie('pv_d')).toBeNull();
    });
  });

  describe('observability on corrupted values', () => {
    it('logs a warn when a cookie value fails to deserialize before regenerating', () => {
      const ppLib = makePPLib();
      const logSpy = ppLib.log as ReturnType<typeof vi.fn>;
      document.cookie = 'pv_corrupt={not-valid-json;path=/';

      const generate = vi.fn(() => 'fresh-uuid');
      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_corrupt',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (raw) => {
          try { JSON.parse(raw); return raw; } catch { return null; }
        },
        generate
      });

      expect(pv.read()).toBe('fresh-uuid');
      expect(generate).toHaveBeenCalledTimes(1);
      // Warn must include the cookie name + raw length so a debugger can
      // map the regeneration back to the affected key.
      const warnCall = logSpy.mock.calls.find(c => c[0] === 'warn');
      expect(warnCall).toBeDefined();
      expect(warnCall![1]).toContain('cookie value failed deserialize');
      expect(warnCall![2]).toMatchObject({ cookieName: 'pv_corrupt' });
    });

    it('logs an info when a legacy localStorage value is corrupt and dropped', () => {
      // Info level (not warn) because legacy-shape entries are EXPECTED
      // on the first visit after a schema upgrade. Warn would trigger
      // false-positive alerts at deploy time.
      const ppLib = makePPLib();
      const logSpy = ppLib.log as ReturnType<typeof vi.fn>;
      localStorage.setItem('legacy_corrupt', '{not-json');

      const pv = createPersistentValue<{ ok: boolean }>(window, ppLib, {
        cookieName: 'pv_legacy_corrupt',
        legacyLocalStorageKey: 'legacy_corrupt',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => {
          try { return JSON.parse(raw); } catch { return null; }
        }
      });

      expect(pv.read()).toBeNull();
      const infoCall = logSpy.mock.calls.find(c =>
        c[0] === 'info' && typeof c[1] === 'string' && c[1].indexOf('legacy localStorage') !== -1
      );
      expect(infoCall).toBeDefined();
      expect(infoCall![2]).toMatchObject({ legacyKey: 'legacy_corrupt' });
      // And the bad legacy value gets cleared.
      expect(localStorage.getItem('legacy_corrupt')).toBeNull();
    });
  });

  describe('legacy cookie migration', () => {
    it('migrates a legacy cookie value into the new cookie name on first read, then deletes the legacy cookie', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_old=legacy-value; path=/';

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => (s.length > 0 ? s : null),
        legacyCookieNames: ['pv_old'],
      });

      expect(pv.read()).toBe('legacy-value');
      expect(ppLib.getCookie('pv_new')).toBe('legacy-value');
      // Legacy cookie purged so subsequent reads come straight from the new name.
      expect(ppLib.getCookie('pv_old')).toBeNull();
    });

    it('the new cookie wins when both new and legacy cookies are present', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_new=new-value; path=/';
      document.cookie = 'pv_old=old-value; path=/';

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => (s.length > 0 ? s : null),
        legacyCookieNames: ['pv_old'],
      });

      expect(pv.read()).toBe('new-value');
    });

    it('tries multiple legacy cookies in order and picks the first that deserializes', () => {
      const ppLib = makePPLib();
      // First legacy candidate is junk; second is valid.
      document.cookie = 'pv_old_a={not-json; path=/';
      document.cookie = 'pv_old_b={"ok":true}; path=/';

      const pv = createPersistentValue<{ ok: boolean }>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => {
          try { return JSON.parse(raw); } catch { return null; }
        },
        legacyCookieNames: ['pv_old_a', 'pv_old_b'],
      });

      expect(pv.read()).toEqual({ ok: true });
      // Both legacy entries cleared after a successful migration.
      expect(ppLib.getCookie('pv_old_a')).toBeNull();
      expect(ppLib.getCookie('pv_old_b')).toBeNull();
    });

    it('cleans up every legacy cookie when none deserialize, then falls through to generate', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_old_x={broken; path=/';
      document.cookie = 'pv_old_y={also-broken; path=/';

      const pv = createPersistentValue<{ ok: boolean }>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: JSON.stringify,
        deserialize: (raw) => {
          try { return JSON.parse(raw); } catch { return null; }
        },
        legacyCookieNames: ['pv_old_x', 'pv_old_y'],
        generate: () => ({ ok: true }),
      });

      expect(pv.read()).toEqual({ ok: true });
      expect(ppLib.getCookie('pv_old_x')).toBeNull();
      expect(ppLib.getCookie('pv_old_y')).toBeNull();
      // New cookie was generated.
      expect(ppLib.getCookie('pv_new')).toBe('{"ok":true}');
    });

    it('clear() also wipes any leftover legacy cookies', () => {
      const ppLib = makePPLib();
      document.cookie = 'pv_old=residue; path=/';

      const pv = createPersistentValue<string>(window, ppLib, {
        cookieName: 'pv_new',
        maxAgeSeconds: 60,
        serialize: (s) => s,
        deserialize: (s) => (s.length > 0 ? s : null),
        legacyCookieNames: ['pv_old'],
      });

      pv.write('current');
      pv.clear();
      expect(ppLib.getCookie('pv_new')).toBeNull();
      expect(ppLib.getCookie('pv_old')).toBeNull();
    });
  });
});
