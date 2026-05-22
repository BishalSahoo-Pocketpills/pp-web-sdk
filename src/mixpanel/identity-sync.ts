/**
 * Identity sync — pin secondary's `$device_id` to primary's so anonymous
 * events on both projects share the same distinct_id.
 *
 * Why this matters: Mixpanel's named instances each generate their own
 * `$device_id` UUID at init. Without pinning, anonymous events on primary
 * get distinct_id `$device:<uuid_a>` and on secondary `$device:<uuid_b>`,
 * making cross-project parity validation for not-yet-logged-in users
 * impossible. After pinning, both instances see the same `$device_id`,
 * and the Simplified ID Merge project (secondary) can correlate anonymous
 * activity with the subsequent identified state.
 *
 * Call order at boot (orchestrated by index.ts):
 *   1. primary.init(token, opts) → primary's `loaded` callback fires
 *   2. primary's `loaded` chains secondary.init(token, opts, 'secondary')
 *   3. secondary's `loaded` callback runs `syncIdentityFromPrimary(mp)`
 *      BEFORE registering any super-props or draining the pre-init queue
 *
 * Call order on reset():
 *   1. dispatch('reset', []) fans out to both instances
 *   2. After fan-out, `resyncAfterReset()` re-pins secondary's device_id
 *      to primary's freshly-generated UUID
 */
import type { PPLib } from '@src/types/common.types';
import type { MixpanelGlobal } from '@src/types/window';
import { getState } from '@src/mixpanel/instance-state';
import { M } from '@src/mixpanel/messages';

let pp: PPLib | null = null;

export function configureIdentitySync(ppLib: PPLib): void {
  pp = ppLib;
}

export function resetIdentitySync(): void {
  pp = null;
}

/**
 * Read primary's anonymous + identified state and apply it to the
 * secondary instance. Safe to call multiple times — `register` overwrites
 * the device_id only when primary's is readable, and `identify` is a
 * no-op if secondary is already on the same distinct_id.
 *
 * Returns whether the pin succeeded (true) or was skipped because primary
 * wasn't readable (false). Callers can log the skip but should not throw.
 */
export function syncIdentityFromPrimary(secondaryMp: MixpanelGlobal): boolean {
  if (!pp) return false;
  try {
    const primaryState = getState('primary');
    const primaryMp = primaryState.mpRef;
    if (!primaryMp) {
      pp.log('warn', M.IDENTITY_SYNC_NO_PRIMARY);
      return false;
    }

    // Pin $device_id first — every subsequent track on secondary will
    // share the same anonymous distinct_id as primary until identify().
    const primaryDeviceId =
      typeof primaryMp.get_property === 'function' ? primaryMp.get_property('$device_id') : undefined;
    if (typeof primaryDeviceId === 'string' && primaryDeviceId.length > 0) {
      secondaryMp.register({ $device_id: primaryDeviceId });
    }

    // Mirror identified state. Primary's get_distinct_id() returns either
    // `$device:<uuid>` (anonymous) or the application-level user ID
    // (identified). We only mirror the identified case — calling
    // secondary.identify('$device:...') corrupts the merge semantics on
    // Simplified ID Merge projects.
    if (typeof primaryMp.get_distinct_id === 'function') {
      const primaryDistinct = primaryMp.get_distinct_id();
      if (
        typeof primaryDistinct === 'string' &&
        primaryDistinct.length > 0 &&
        primaryDistinct.indexOf('$device:') !== 0
      ) {
        secondaryMp.identify(primaryDistinct);
      }
    }

    pp.log('info', M.SECONDARY_IDENTITY_SYNCED);
    return true;
  } catch (e) {
    pp.log('warn', M.IDENTITY_SYNC_ERROR, pp.safeLogError(e));
    return false;
  }
}

/**
 * Called after a dispatched `reset()` so secondary doesn't drift back to
 * its own freshly-generated UUID. Both instances will have just generated
 * NEW device_ids; we want them to share primary's new one.
 */
export function resyncAfterReset(): boolean {
  if (!pp) return false;
  const secondaryState = getState('secondary');
  if (!secondaryState.enabled || !secondaryState.mpRef) return false;
  return syncIdentityFromPrimary(secondaryState.mpRef);
}
