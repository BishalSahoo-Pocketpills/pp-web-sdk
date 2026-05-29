/**
 * Shared authentication-state guard for boot-time `people.*` dispatches.
 *
 * Per Mixpanel's Simplified ID Merge guidance, profile-property writes
 * (`people.set`, `people.set_once`, `people.increment`, `people.union`,
 * `people.append`, `people.track_charge`) must NOT fire for anonymous
 * visitors — they would materialise a `$device:<uuid>`-keyed profile that
 * pollutes user counts, inflates DAU/MAU, and forces a redundant server-
 * side merge step on the eventual `identify(userId)` call.
 *
 * Super-property writes (`register`, `register_once`) are unaffected —
 * those attach to events going forward, not to a profile, so they're
 * safe to fire at any auth state.
 *
 * This file is the single source of truth for that gate. Every boot-time
 * `people.*` dispatch site MUST short-circuit when `isAuthenticated(pp)`
 * returns false. See `shared-context.ts` and `campaign.ts` for the call
 * sites; see Mixpanel's identity-management docs for the underlying
 * reason at https://docs.mixpanel.com/docs/tracking-methods/id-management
 * /identifying-users.
 *
 * Defensive default: any read failure (no builder, build throws, missing
 * `logged_in` field) returns `false`. Skipping a profile write is always
 * recoverable — the next page load with a valid auth state will fire
 * normally. Firing prematurely on an anonymous visitor is not recoverable
 * without server-side profile deletion.
 */
import type { PPLib } from '@src/types/common.types';

/**
 * Returns true when the current visitor is authenticated per the SDK's
 * `logged_in` event property (derived from `userId` + `patientId` +
 * `app_is_authenticated` cookies Angular owns).
 *
 * @param pp — the configured PPLib reference; the function reads
 *             `pp.eventPropertiesBuilder.build()` to resolve the bundle.
 * @returns `true` when `bundle.eventProperties.logged_in === 'true'`;
 *          `false` for anonymous visitors, missing builder, or any read
 *          failure. Defensive — never throws.
 */
export function isAuthenticated(pp: PPLib): boolean {
  if (!pp.eventPropertiesBuilder) return false;
  try {
    const bundle = pp.eventPropertiesBuilder.build();
    return bundle.eventProperties.logged_in === 'true';
  } catch {
    return false;
  }
}
