/**
 * Module-scoped consent gate.
 *
 * `ppLib.consent` (in `src/common/consent.ts`) is the cross-module dispatch
 * gate added in Track 6. Some feature modules (Braze, Voucherify) carried
 * their own `hasConsent()` helper that predates `ppLib.consent` and still
 * exists for backward compatibility — same logic, copy-pasted:
 *
 *   - If the module's `consent.required` flag is false, allow.
 *   - If `mode === 'analytics'`, delegate to `window.ppAnalytics.consent
 *     .status()` (the customer's ppAnalytics module). On error, fail closed.
 *   - If `mode === 'custom'`, call the configured `checkFunction()`.
 *
 * This module factors that out so a behavior change (e.g. adding a new
 * mode, changing the default-deny posture) is single-source.
 *
 * NOTE: This is the module's own gate, separate from `ppLib.consent`.
 * The recommended migration is to flip module-level `consent.required`
 * to false and let `ppLib.consent.isGranted()` enforce gating at dispatch
 * sites. Both modes are supported during the transition.
 */

import type { PPLib } from '@src/types/common.types';

/** Per-module consent mode (legacy, transitioning to the unified ppLib.consent service). */
export type ModuleConsentMode = 'analytics' | 'custom';

export interface ModuleConsentConfig {
  required: boolean;
  mode: ModuleConsentMode;
  checkFunction: () => boolean;
}

export interface ConsentCheckEnv {
  win: Window & typeof globalThis;
  ppLib: PPLib;
  /** Module log prefix (e.g. '[ppBraze]', '[ppVoucherify]') used in error logs. */
  logPrefix: string;
}

/**
 * Evaluate a module's consent gate. Returns true when the module is
 * allowed to proceed, false when consent denies the operation.
 */
export function checkModuleConsent(
  config: ModuleConsentConfig,
  env: ConsentCheckEnv,
): boolean {
  if (!config.required) return true;

  if (config.mode === 'analytics') {
    try {
      const ppAnalytics = env.win.ppAnalytics;
      if (
        ppAnalytics &&
        typeof ppAnalytics.consent === 'object' &&
        ppAnalytics.consent !== null &&
        typeof ppAnalytics.consent.status === 'function'
      ) {
        return ppAnalytics.consent.status();
      }
    } catch (e) {
      env.ppLib.log(
        'error',
        env.logPrefix + ' consent check error',
        env.ppLib.safeLogError(e),
      );
    }
    return false;
  }

  // custom mode
  return config.checkFunction();
}
