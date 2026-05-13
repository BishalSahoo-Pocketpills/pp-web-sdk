/**
 * Module-bootstrap HOF.
 *
 * Every feature module (analytics, braze, ecommerce, event-source, login,
 * mixpanel, voucherify, vwo, datalayer) ends with the same 6 lines:
 *
 *     if (win.ppLib && win.ppLib._isReady) {
 *       initModule(win.ppLib);
 *     } else {
 *       win.ppLibReady = win.ppLibReady || [];
 *       win.ppLibReady.push(initModule);
 *     }
 *
 * That's ~60 lines of duplicated boot logic. `bootstrapModule` factors it
 * out so a future change to the boot protocol (e.g. async ppLib install,
 * timeout-then-warn, instrumentation) lands in one place.
 *
 * Usage at the bottom of every module's IIFE:
 *
 *     bootstrapModule(win, initModule);
 *
 * Kept narrow on purpose — no fancy abstractions over the queue contract.
 * `win.ppLibReady` is a public-ish slot; the array push protocol is shared
 * with the common module's ready loop.
 */

import type { PPLib } from '@src/types/common.types';

export function bootstrapModule(
  win: Window & typeof globalThis,
  initModule: (ppLib: PPLib) => void,
): void {
  /*! v8 ignore start — boot conditional varies by test harness ordering */
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }
  /*! v8 ignore stop */
}
