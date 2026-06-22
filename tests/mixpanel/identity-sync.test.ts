/**
 * Direct unit tests for the dual-instance identity sync.
 *
 * Replaces a previously tautological test in dual-instance-coverage.test.ts that
 * only exercised the dispatch facade (api.secondary.identify) and never the
 * sync's actual contract — most importantly the `$device:` anonymous guard,
 * which must NOT mirror an anonymous distinct_id onto secondary (doing so
 * corrupts Simplified ID Merge). Deleting that guard previously kept the whole
 * suite green; these tests fail if it is removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureIdentitySync,
  syncIdentityFromPrimary,
  resyncAfterReset,
} from '../../src/mixpanel/identity-sync';
import {
  getState,
  resetInstanceState,
  setEnabled,
} from '../../src/mixpanel/instance-state';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';
import { M } from '../../src/mixpanel/messages';
import type { PPLib } from '../../src/types/common.types';
import type { MixpanelGlobal } from '../../src/types/window';

function makePPLib() {
  const log = vi.fn();
  const safeLogError = vi.fn((e: unknown) => ({ message: String(e) }));
  const ppLib = { log, safeLogError } as unknown as PPLib;
  return { ppLib, log };
}

function asMp(mock: ReturnType<typeof createMockMixpanel>): MixpanelGlobal {
  return mock as unknown as MixpanelGlobal;
}

describe('identity-sync (direct unit)', () => {
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetInstanceState();
    const ctx = makePPLib();
    log = ctx.log;
    configureIdentitySync(ctx.ppLib);
  });

  it('mirrors $device_id and an IDENTIFIED distinct_id from primary to secondary', () => {
    const primary = createMockMixpanel();
    primary.get_property = vi.fn((k: string) => (k === '$device_id' ? 'P-DEV' : undefined));
    primary.get_distinct_id = vi.fn(() => 'user-99');
    getState('primary').mpRef = asMp(primary);

    const secondary = createMockMixpanel();
    const ok = syncIdentityFromPrimary(asMp(secondary));

    expect(ok).toBe(true);
    expect(secondary.register).toHaveBeenCalledWith({ $device_id: 'P-DEV' });
    expect(secondary.identify).toHaveBeenCalledWith('user-99');
  });

  it('does NOT identify secondary when primary is still anonymous ($device:)', () => {
    const primary = createMockMixpanel();
    primary.get_property = vi.fn((k: string) => (k === '$device_id' ? 'P-DEV' : undefined));
    primary.get_distinct_id = vi.fn(() => '$device:anon-abc');
    getState('primary').mpRef = asMp(primary);

    const secondary = createMockMixpanel();
    const ok = syncIdentityFromPrimary(asMp(secondary));

    expect(ok).toBe(true);
    // device_id is still pinned so both share the anonymous distinct_id...
    expect(secondary.register).toHaveBeenCalledWith({ $device_id: 'P-DEV' });
    // ...but identify must NOT be called with the anonymous id (merge guard).
    expect(secondary.identify).not.toHaveBeenCalled();
  });

  it('skips the device_id pin when primary has no readable $device_id', () => {
    const primary = createMockMixpanel();
    primary.get_property = vi.fn(() => undefined);
    primary.get_distinct_id = vi.fn(() => 'user-7');
    getState('primary').mpRef = asMp(primary);

    const secondary = createMockMixpanel();
    const ok = syncIdentityFromPrimary(asMp(secondary));

    expect(ok).toBe(true);
    expect(secondary.register).not.toHaveBeenCalled();
    expect(secondary.identify).toHaveBeenCalledWith('user-7');
  });

  it('returns false and warns when primary is not loaded', () => {
    // resetInstanceState() left primary.mpRef undefined.
    const secondary = createMockMixpanel();
    const ok = syncIdentityFromPrimary(asMp(secondary));

    expect(ok).toBe(false);
    expect(log).toHaveBeenCalledWith('warn', M.IDENTITY_SYNC_NO_PRIMARY);
    expect(secondary.register).not.toHaveBeenCalled();
  });

  it('returns false and logs when the secondary call throws', () => {
    const primary = createMockMixpanel();
    primary.get_property = vi.fn((k: string) => (k === '$device_id' ? 'P-DEV' : undefined));
    getState('primary').mpRef = asMp(primary);

    const secondary = createMockMixpanel();
    secondary.register = vi.fn(() => { throw new Error('register boom'); });
    const ok = syncIdentityFromPrimary(asMp(secondary));

    expect(ok).toBe(false);
    expect(log).toHaveBeenCalledWith('warn', M.IDENTITY_SYNC_ERROR, expect.anything());
  });

  it('returns false when the sync service was never configured', () => {
    configureIdentitySync(null as unknown as PPLib);
    expect(syncIdentityFromPrimary(asMp(createMockMixpanel()))).toBe(false);
  });

  describe('resyncAfterReset', () => {
    it('is a no-op (false) when secondary is disabled or has no ref', () => {
      const primary = createMockMixpanel();
      getState('primary').mpRef = asMp(primary);
      expect(resyncAfterReset()).toBe(false); // secondary disabled by default
    });

    it('re-pins secondary to primary once secondary is enabled and ready', () => {
      const primary = createMockMixpanel();
      primary.get_property = vi.fn((k: string) => (k === '$device_id' ? 'P-DEV-NEW' : undefined));
      primary.get_distinct_id = vi.fn(() => '$device:fresh');
      getState('primary').mpRef = asMp(primary);

      const secondary = createMockMixpanel();
      setEnabled('secondary', true);
      getState('secondary').mpRef = asMp(secondary);

      expect(resyncAfterReset()).toBe(true);
      expect(secondary.register).toHaveBeenCalledWith({ $device_id: 'P-DEV-NEW' });
    });
  });
});
