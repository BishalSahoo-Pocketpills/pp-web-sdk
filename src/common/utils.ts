import type { PPLib } from '@src/types/common.types';

export function createExtend(
  log: PPLib['log']
): (target: any, source: any) => any {
  function extend(target: any, source: any): any {
    if (!target || !source) return target || {};

    try {
      for (const key in source) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (source.hasOwnProperty(key)) {
          if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
            target[key] = target[key] || {};
            extend(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
      }
    } catch (e) {
      log('error', 'Extend error:', e);
    }

    return target;
  }

  return extend;
}
