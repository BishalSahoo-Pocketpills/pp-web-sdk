import type { PPLibConfig, SafeUtils, Security, Storage } from '@src/types/common.types';

// Narrow indexed access to the standard Storage globals so we don't reach for
// `(win as any)[type]`. Callers always pass `'localStorage'` or
// `'sessionStorage'`; anything else short-circuits via `pickStore`.
type StorageType = 'localStorage' | 'sessionStorage';
type WindowWithStorage = Record<StorageType, globalThis.Storage>;

function pickStore(win: Window & typeof globalThis, type: StorageType): globalThis.Storage | null {
  try {
    const s = (win as unknown as WindowWithStorage)[type];
    return s || null;
  } catch (e) {
    return null;
  }
}

export function createStorage(
  win: Window & typeof globalThis,
  config: PPLibConfig,
  safeUtils: SafeUtils,
  security: Security,
  log: (level: string, message: string, data?: unknown) => void
): Storage {
  // Self-referential object literal so internal calls go through the public
  // surface (`storage.isAvailable`, `storage.remove`) — preserves the contract
  // that test doubles spying on those methods are honored from inside set/get.
  const storage: Storage = {
    isAvailable(type?: string): boolean {
      try {
        const t = (type || 'sessionStorage') as StorageType;
        const s = pickStore(win, t);
        if (!s) return false;

        const test = '__storage_test__';
        s.setItem(test, test);
        s.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    },

    getKey(key: string): string {
      try {
        const namespace = config.namespace || 'pp_attr';
        return namespace + '_' + key;
      } catch (e) {
        return 'pp_attr_' + key;
      }
    },

    set(key: string, value: unknown, persistent?: boolean): boolean {
      try {
        if (!safeUtils.exists(key) || value === null || value === undefined) return false;

        const storageType: StorageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return false;

        if (!security.validateData(value)) {
          log('error', 'Invalid data rejected');
          return false;
        }

        const stringified = security.json.stringify(value);
        if (!stringified) return false;

        const store = pickStore(win, storageType);
        if (!store) return false;
        store.setItem(storage.getKey(key), stringified);
        return true;
      } catch (e) {
        log('verbose', 'Storage set error', e);
        return false;
      }
    },

    get<T = unknown>(key: string, persistent?: boolean, validate?: (v: unknown) => v is T): T | null {
      try {
        if (!safeUtils.exists(key)) return null;

        const storageType: StorageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return null;

        const store = pickStore(win, storageType);
        if (!store) return null;

        const item = store.getItem(storage.getKey(key));
        if (!safeUtils.exists(item)) return null;

        const parsed = security.json.parse(item as string);

        if (parsed && typeof parsed === 'object' && !security.validateData(parsed)) {
          storage.remove(key, persistent);
          return null;
        }

        if (typeof validate === 'function' && !validate(parsed)) return null;

        return parsed as T | null;
      } catch (e) {
        log('verbose', 'Storage get error', e);
        return null;
      }
    },

    remove(key: string, persistent?: boolean): void {
      try {
        if (!safeUtils.exists(key)) return;

        const storageType: StorageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return;

        const store = pickStore(win, storageType);
        if (!store) return;
        store.removeItem(storage.getKey(key));
      } catch (e) {
        log('verbose', 'Storage remove error', e);
      }
    },

    clear(): void {
      try {
        storage.remove('first_touch');
        storage.remove('last_touch');
        storage.remove('session_start');
        storage.remove('first_touch', true);
        storage.remove('last_touch', true);
        log('info', 'Storage cleared');
      } catch (e) {
        log('error', 'Storage clear error', e);
      }
    }
  };

  return storage;
}
