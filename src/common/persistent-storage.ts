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

    // 2. Legacy localStorage — one-time migration. Copy to cookie, delete
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

    // 3. Generate (when caller provided a generator).
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
    deleteLocalStorage();
  }

  return { read: read, write: write, clear: clear };
}
