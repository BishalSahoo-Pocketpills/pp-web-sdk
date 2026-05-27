import type { LogLevel } from '@src/types/common.types';

const SRI_PATTERN = /^(sha256|sha384|sha512)-[A-Za-z0-9+/=]+$/;

export type SriCheckResult = 'valid' | 'invalid-format' | 'missing-required' | 'missing-optional';

/**
 * Validate an SRI integrity hash. Returns a result code — the caller
 * decides how to log/bail based on their module prefix.
 */
export function checkSriIntegrity(
  integrity: string | undefined,
  requireIntegrity: boolean | undefined,
): SriCheckResult {
  if (integrity) {
    return SRI_PATTERN.test(integrity) ? 'valid' : 'invalid-format';
  }
  return requireIntegrity ? 'missing-required' : 'missing-optional';
}
