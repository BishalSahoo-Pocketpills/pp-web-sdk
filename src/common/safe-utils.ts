import type { SafeUtils } from '../types/common.types';

export function createSafeUtils(log: (level: string, message: string, data?: any) => void): SafeUtils {
  return {
    get(obj: any, path: string, defaultValue?: any): any {
      if (!obj || typeof obj !== 'object') return defaultValue;

      const keys = path.split('.');
      let result = obj;

      for (let i = 0; i < keys.length; i++) {
        if (result === null || result === undefined || typeof result !== 'object') {
          return defaultValue;
        }
        result = result[keys[i]];
      }

      return result !== undefined ? result : defaultValue;
    },

    set(obj: any, path: string, value: any): boolean {
      if (!obj || typeof obj !== 'object') return false;

      try {
        const keys = path.split('.');
        let target = obj;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
            target[keys[i]] = {};
          }
          target = target[keys[i]];
        }

        target[keys[keys.length - 1]] = value;
        return true;
      } catch (e) {
        return false;
      }
    },

    toString(val: any): string {
      if (val === null || val === undefined) return '';
      return String(val);
    },

    exists(val: any): boolean {
      return val !== null && val !== undefined && val !== '';
    },

    toArray(val: any): any[] {
      if (Array.isArray(val)) return val;
      if (!val) return [];
      return [val];
    },

    forEach(arr: any[], callback: (item: any, index: number, arr: any[]) => void): void {
      if (!Array.isArray(arr) || typeof callback !== 'function') return;

      try {
        for (let i = 0; i < arr.length; i++) {
          callback(arr[i], i, arr);
        }
      } catch (e) {
        log('error', 'forEach error:', e);
      }
    }
  };
}
