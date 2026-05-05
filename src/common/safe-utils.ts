import type { SafeUtils } from '@src/types/common.types';

export function createSafeUtils(log: (level: string, message: string, data?: unknown) => void): SafeUtils {
  // Implementation type for `get` covers all overloads; the public interface
  // narrows return type via the overloaded call signatures (literal-typed
  // defaults widen to their primitives).
  function get(obj: unknown, path: string, defaultValue: string): string;
  function get(obj: unknown, path: string, defaultValue: number): number;
  function get(obj: unknown, path: string, defaultValue: boolean): boolean;
  function get<T>(obj: unknown, path: string, defaultValue: T): T;
  function get(obj: unknown, path: string): unknown;
  function get(obj: unknown, path: string, defaultValue?: unknown): unknown {
    if (!obj || typeof obj !== 'object') return defaultValue;

    const keys = path.split('.');
    let result: unknown = obj;

    for (let i = 0; i < keys.length; i++) {
      if (result === null || result === undefined || typeof result !== 'object') {
        return defaultValue;
      }
      result = (result as Record<string, unknown>)[keys[i]];
    }

    return result !== undefined ? result : defaultValue;
  }

  function set(obj: object, path: string, value: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;

    try {
      const keys = path.split('.');

      // Guard against prototype pollution
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === '__proto__' || keys[i] === 'constructor' || keys[i] === 'prototype') {
          log('warn', 'Blocked prototype pollution attempt: ' + path);
          return false;
        }
      }

      let target: Record<string, unknown> = obj as Record<string, unknown>;

      for (let i = 0; i < keys.length - 1; i++) {
        const next = target[keys[i]];
        if (!next || typeof next !== 'object') {
          target[keys[i]] = {};
        }
        target = target[keys[i]] as Record<string, unknown>;
      }

      target[keys[keys.length - 1]] = value;
      return true;
    } catch (e) {
      return false;
    }
  }

  function toString(val: unknown): string {
    if (val === null || val === undefined) return '';
    return String(val);
  }

  function exists(val: unknown): boolean {
    return val !== null && val !== undefined && val !== '';
  }

  function toArray<T = unknown>(val: T | T[] | null | undefined): T[] {
    if (Array.isArray(val)) return val;
    // Preserve historical contract: any falsy value (0, '', false, null,
    // undefined) yields an empty array; truthy non-array values are wrapped.
    if (!val) return [];
    return [val];
  }

  function forEach<T>(arr: T[], callback: (item: T, index: number, arr: T[]) => void): void {
    if (!Array.isArray(arr) || typeof callback !== 'function') return;

    try {
      for (let i = 0; i < arr.length; i++) {
        callback(arr[i], i, arr);
      }
    } catch (e) {
      log('error', 'forEach error:', e);
    }
  }

  return {
    get,
    set,
    toString,
    exists,
    toArray,
    forEach
  };
}
