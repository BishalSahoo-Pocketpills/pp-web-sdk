import type { PPLibConfig, SafeUtils, Security, Storage } from '../types/common.types';

export function createStorage(
  win: Window & typeof globalThis,
  config: PPLibConfig,
  safeUtils: SafeUtils,
  security: Security,
  log: (level: string, message: string, data?: any) => void
): Storage {
  const storage: Storage = {
    isAvailable(type?: string): boolean {
      try {
        type = type || 'sessionStorage';
        const s = (win as any)[type];
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

    set(key: string, value: any, persistent?: boolean): boolean {
      try {
        if (!safeUtils.exists(key) || !value) return false;

        const storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return false;

        if (!security.validateData(value)) {
          log('error', 'Invalid data rejected');
          return false;
        }

        const stringified = security.json.stringify(value);
        if (!stringified) return false;

        (win as any)[storageType].setItem(storage.getKey(key), stringified);
        return true;
      } catch (e) {
        log('verbose', 'Storage set error', e);
        return false;
      }
    },

    get(key: string, persistent?: boolean): any {
      try {
        if (!safeUtils.exists(key)) return null;

        const storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return null;

        const item = (win as any)[storageType].getItem(storage.getKey(key));
        if (!safeUtils.exists(item)) return null;

        const parsed = security.json.parse(item);

        if (parsed && typeof parsed === 'object' && !security.validateData(parsed)) {
          storage.remove(key, persistent);
          return null;
        }

        return parsed;
      } catch (e) {
        log('verbose', 'Storage get error', e);
        return null;
      }
    },

    remove(key: string, persistent?: boolean): void {
      try {
        if (!safeUtils.exists(key)) return;

        const storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!storage.isAvailable(storageType)) return;

        (win as any)[storageType].removeItem(storage.getKey(key));
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
