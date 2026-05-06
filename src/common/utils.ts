import type { PPLib } from '@src/types/common.types';

export function createExtend(
  log: PPLib['log']
): <T extends object, U>(target: T, source: U) => T & U {
  // Internal pass uses Record<string, unknown> so the recursive walk has
  // index access. The exported wrapper preserves the generic shape that
  // PPLib.extend declares, which is what callers see.
  function extendInternal(target: Record<string, unknown>, source: Record<string, unknown>): void {
    if (!target || !source) return;

    try {
      for (const key in source) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          const sv = source[key];
          if (typeof sv === 'object' && sv !== null && !Array.isArray(sv)) {
            // Preserve historical contract: a truthy existing target value
            // is kept (`target[key] || {}`). Recursing into a non-object
            // value is a no-op because extendInternal short-circuits on
            // non-object targets.
            const existing = target[key];
            if (!existing) target[key] = {};
            extendInternal(target[key] as Record<string, unknown>, sv as Record<string, unknown>);
          } else {
            target[key] = sv;
          }
        }
      }
    } catch (e) {
      log('error', 'Extend error:', e);
    }
  }

  return function extend<T extends object, U>(target: T, source: U): T & U {
    if (!target) return (target || {}) as T & U;
    if (source === null || source === undefined) return target as T & U;
    extendInternal(target as Record<string, unknown>, source as unknown as Record<string, unknown>);
    return target as T & U;
  };
}
