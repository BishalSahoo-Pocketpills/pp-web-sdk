import type { PPLib } from '@src/types/common.types';

/**
 * Returns true if consent is granted (or if no consent service is loaded).
 * The null-check on ppLib.consent is load-bearing — modules that load
 * before the common consent service is wired must not crash.
 */
export function isConsentGranted(ppLib: PPLib): boolean {
  if (typeof ppLib.consent?.isGranted !== 'function') return true;
  return ppLib.consent.isGranted();
}
