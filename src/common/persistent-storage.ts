/**
 * Persistent value factory — cross-subdomain cookie storage with a one-time
 * localStorage migration path.
 *
 * The SDK's identity values (device_id, session_id, UTM touches) must
 * survive navigation between try.pocketpills.com and www.pocketpills.com.
 * Origin-scoped localStorage doesn't; a cookie with `Domain=.pocketpills.com`
 * does. Each `PersistentValue<T>` wraps a single key with:
 *
 *   read():  cookie → legacy localStorage (migrate + delete) → generate() → null
 *   write(): serialize + write cookie with the configured domain / max-age
 *   clear(): delete cookie + delete legacy localStorage key (defensive)
 *
 * Read-first / write-only-if-absent semantics avoid clobbering values
 * already written by the Angular webapp side, which is aligning on the same
 * cookie names.
 */
import type { PPLib } from '@src/types/common.types';

export interface PersistentValueOptions<T> {
  cookieName: string;
  /** Sliding max-age (seconds) applied on every write. */
  maxAgeSeconds: number;
  serialize: (value: T) => string;
  /** Return null on parse failure / non-conforming shape — callers fall back to generate(). */
  deserialize: (raw: string) => T | null;
  /** Optional. When omitted, read() returns null instead of generating. */
  generate?: () => T;
  /** Legacy localStorage key for one-time migration; deleted after the value is copied into the cookie. */
  legacyLocalStorageKey?: string;
  /**
   * Legacy cookie names to migrate from (ordered: first match wins).
   * On read, if the primary cookie is absent, each legacy name is consulted in
   * order; the first decoded value is copied into the new cookie and every
   * legacy entry is deleted. Enables in-flight cookie renames without losing
   * established users' session/identity continuity.
   */
  legacyCookieNames?: string[];
}

export interface PersistentValue<T> {
  read: () => T | null;
  write: (value: T) => void;
  clear: () => void;
}

export function createPersistentValue<T>(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  opts: PersistentValueOptions<T>
): PersistentValue<T> {

  function readLocalStorage(): string | null {
    if (!opts.legacyLocalStorageKey) return null;
    try {
      return win.localStorage.getItem(opts.legacyLocalStorageKey);
    } catch (e) {
      return null;
    }
  }

  function deleteLocalStorage(): void {
    if (!opts.legacyLocalStorageKey) return;
    try {
      win.localStorage.removeItem(opts.legacyLocalStorageKey);
    } catch (e) {
      // best-effort — disabled storage is fine
    }
  }

  function write(value: T): void {
    try {
      const raw = opts.serialize(value);
      ppLib.setCookie(opts.cookieName, raw, {
        domain: ppLib.config.cookieDomain,
        path: '/',
        maxAgeSeconds: opts.maxAgeSeconds,
        sameSite: 'Lax'
      });
    } catch (e) {
      // best-effort persistence — surface via the existing log channel
      ppLib.log('error', 'persistentValue.write error', { cookieName: opts.cookieName });
    }
  }

  function deleteLegacyCookies(): void {
    if (!opts.legacyCookieNames || opts.legacyCookieNames.length === 0) return;
    for (const legacyName of opts.legacyCookieNames) {
      try {
        ppLib.setCookie(legacyName, '', {
          domain: ppLib.config.cookieDomain,
          path: '/',
          maxAgeSeconds: 0,
          sameSite: 'Lax'
        });
      } catch (e) {
        // best-effort
      }
      try {
        ppLib.deleteCookie(legacyName);
      } catch (e) {
        // best-effort — covers the host-scoped legacy form
      }
    }
  }

  function read(): T | null {
    // 1. Cookie — primary source after migration completes.
    const cookieRaw = ppLib.getCookie(opts.cookieName);
    if (cookieRaw !== null && cookieRaw !== '') {
      const parsed = opts.deserialize(cookieRaw);
      if (parsed !== null) return parsed;
      // Parse failure → fall through to legacy / generate so we self-heal.
      // Log the regeneration so debugging is possible (the cookie value
      // landed in a state the caller's deserializer rejected — often
      // an out-of-date schema). Shape-only; no raw value logged.
      ppLib.log(
        'warn',
        '[persistent-storage] cookie value failed deserialize; regenerating',
        { cookieName: opts.cookieName, rawLength: cookieRaw.length },
      );
    }

    // 2. Legacy cookie names — one-time rename migration. First match wins;
    //    all legacy entries are deleted regardless so subsequent reads come
    //    from the canonical cookie name.
    if (opts.legacyCookieNames && opts.legacyCookieNames.length > 0) {
      for (const legacyName of opts.legacyCookieNames) {
        const legacyCookieRaw = ppLib.getCookie(legacyName);
        if (legacyCookieRaw === null || legacyCookieRaw === '') continue;
        const parsed = opts.deserialize(legacyCookieRaw);
        if (parsed !== null) {
          write(parsed);
          deleteLegacyCookies();
          return parsed;
        }
        // Legacy cookie failed to deserialize — drop it and keep looking.
        ppLib.log(
          'info',
          '[persistent-storage] legacy cookie value failed deserialize; dropping',
          { cookieName: opts.cookieName, legacyCookieName: legacyName, rawLength: legacyCookieRaw.length },
        );
      }
      // If we got here, every legacy cookie was empty or unparseable —
      // clean them up so we don't keep checking on every read.
      deleteLegacyCookies();
    }

    // 3. Legacy localStorage — one-time migration. Copy to cookie, delete
    //    the local entry so subsequent reads come from the cookie.
    const legacyRaw = readLocalStorage();
    if (legacyRaw !== null && legacyRaw !== '') {
      const parsed = opts.deserialize(legacyRaw);
      if (parsed !== null) {
        write(parsed);
        deleteLocalStorage();
        return parsed;
      }
      // Legacy entry failed to deserialize — this is EXPECTED on the first
      // visit after a schema upgrade (e.g., pre-1C TouchAttribution missing
      // referrerDomain). Logged at info level (not warn) so Sentry / alert
      // thresholds tied to warn count don't spike on rollout.
      ppLib.log(
        'info',
        '[persistent-storage] legacy localStorage value failed deserialize; dropping',
        { cookieName: opts.cookieName, legacyKey: opts.legacyLocalStorageKey, rawLength: legacyRaw.length },
      );
      deleteLocalStorage();
    }

    // 4. Generate (when caller provided a generator).
    if (opts.generate) {
      const generated = opts.generate();
      write(generated);
      return generated;
    }

    return null;
  }

  function clear(): void {
    // Delete via setCookie with Max-Age=0 + the configured domain — the
    // browser only matches deletes against the same Domain attribute the
    // cookie was written with. ppLib.deleteCookie() doesn't accept a domain
    // and would leave the cookie behind on cross-subdomain installs.
    try {
      ppLib.setCookie(opts.cookieName, '', {
        domain: ppLib.config.cookieDomain,
        path: '/',
        maxAgeSeconds: 0,
        sameSite: 'Lax'
      });
    } catch (e) {
      // best-effort
    }
    // Also call deleteCookie for the host-scoped legacy form (in case the
    // cookie predates the domain rollout).
    try {
      ppLib.deleteCookie(opts.cookieName);
    } catch (e) {
      // best-effort
    }
    // Mid-migration callers may still have legacy-named cookies kicking
    // around — wipe those too so clear() leaves no residue.
    deleteLegacyCookies();
    deleteLocalStorage();
  }

  return { read: read, write: write, clear: clear };
}

// ── localStorage-primary storage ──────────────────────────────────────
// For values that only need to be read by client-side JS (not sent with
// HTTP requests). On first read, migrates any existing cookie value into
// localStorage and deletes the cookie to free header budget.

export interface LocalStorageValueOptions<T> {
  key: string;
  serialize: (value: T) => string;
  deserialize: (raw: string) => T | null;
  generate?: () => T;
  /** Cookie name to migrate FROM (one-time). Deleted after migration. */
  legacyCookieName?: string;
}

export function createLocalStorageValue<T>(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  opts: LocalStorageValueOptions<T>
): PersistentValue<T> {

  function deleteLegacyCookie(): void {
    if (!opts.legacyCookieName) return;
    try {
      ppLib.setCookie(opts.legacyCookieName, '', {
        domain: ppLib.config.cookieDomain,
        path: '/',
        maxAgeSeconds: 0,
        sameSite: 'Lax'
      });
    } catch (_e) { /* best-effort */ }
    try { ppLib.deleteCookie(opts.legacyCookieName); } catch (_e) { /* best-effort */ }
  }

  function write(value: T): void {
    try {
      win.localStorage.setItem(opts.key, opts.serialize(value));
    } catch (_e) {
      ppLib.log('error', 'localStorageValue.write error', { key: opts.key });
    }
  }

  function read(): T | null {
    // 1. localStorage — primary source.
    try {
      const raw = win.localStorage.getItem(opts.key);
      if (raw !== null && raw !== '') {
        const parsed = opts.deserialize(raw);
        if (parsed !== null) return parsed;
      }
    } catch (_e) { /* disabled localStorage — fall through */ }

    // 2. Legacy cookie — one-time migration into localStorage.
    if (opts.legacyCookieName) {
      const cookieRaw = ppLib.getCookie(opts.legacyCookieName);
      if (cookieRaw !== null && cookieRaw !== '') {
        const parsed = opts.deserialize(cookieRaw);
        if (parsed !== null) {
          write(parsed);
          deleteLegacyCookie();
          return parsed;
        }
      }
      deleteLegacyCookie();
    }

    // 3. Generate if caller provided a generator.
    if (opts.generate) {
      const generated = opts.generate();
      write(generated);
      return generated;
    }

    return null;
  }

  function clear(): void {
    try { win.localStorage.removeItem(opts.key); } catch (_e) { /* best-effort */ }
    deleteLegacyCookie();
  }

  return { read: read, write: write, clear: clear };
}
