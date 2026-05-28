/**
 * Subdomain → parent-domain cookie migration. PRIMARY-ONLY — the secondary
 * (new) Mixpanel project has no legacy subdomain cookies to migrate; running
 * the migration on it would read PRIMARY's old cookie and incorrectly
 * re-identify secondary against an outdated distinct_id.
 *
 * The migration flag is per-token (`pp_mp_migrated_<token>`) so primary and
 * secondary don't share state — important defensively in case the design
 * ever changes to migrate both.
 *
 * Background: Mixpanel cookies set with `cross_subdomain_cookie: true`
 * write to `.pocketpills.com`. Users who established identity under the
 * pre-migration `app.pocketpills.com`-scoped cookie need the SDK to detect
 * the new init's mismatched distinct_id and re-identify to preserve profile
 * continuity. Detail:
 *   1. Pre-init: read distinct_id from any legacy cookie.
 *   2. Mixpanel init runs with cross_subdomain_cookie: true.
 *   3. Post-init: if post != pre AND pre was identified (no `$device:`),
 *      call identify(pre) to restore continuity.
 *   4. Anonymous-only legacy users get a new $device_id; future identify()
 *      merges history via Mixpanel's standard merge.
 */
import type { PPLib } from '@src/types/common.types';
import type { MixpanelGlobal } from '@src/types/window';
import { COOKIE_KEYS, M } from '@src/mixpanel/messages';

let pp: PPLib | null = null;

export function configureCookieMigration(ppLib: PPLib): void {
  pp = ppLib;
}

export interface MigrationContext {
  preInitDistinctId: string | null;
}

/**
 * Pre-init step — read the legacy distinct_id before Mixpanel overwrites
 * it. Returns a context the post-init step uses to decide whether to
 * re-identify. Sets a per-token sessionStorage flag so we only do this
 * read once per page-session per project.
 */
export function readPreInitDistinctId(
  win: Window & typeof globalThis,
  token: string,
  crossSubdomainCookie: boolean,
): MigrationContext {
  const ctx: MigrationContext = { preInitDistinctId: null };
  if (!pp || !crossSubdomainCookie || !token) return ctx;

  try {
    const migrationKey = COOKIE_KEYS.MIGRATION_FLAG(token);
    // Legacy single-token deploys used the unsuffixed key. Honor BOTH so
    // existing users mid-rollout don't re-trigger migration when the
    // per-token key gets introduced.
    let alreadyMigrated = false;
    try {
      alreadyMigrated =
        win.sessionStorage.getItem(migrationKey) === '1' ||
        win.sessionStorage.getItem(COOKIE_KEYS.LEGACY_MIGRATION_FLAG) === '1';
    } catch (_e) {
      /* no sessionStorage */
    }

    if (!alreadyMigrated) {
      const mpCookieName = COOKIE_KEYS.MP_COOKIE(token);
      const mpCookie = pp.getCookie(mpCookieName);
      if (mpCookie) {
        const parsed = pp.Security.json.parse(mpCookie);
        if (parsed && typeof parsed === 'object' && 'distinct_id' in parsed) {
          const id = (parsed as { distinct_id: unknown }).distinct_id;
          if (id !== undefined && id !== null) ctx.preInitDistinctId = String(id);
        }
      }
      try {
        win.sessionStorage.setItem(migrationKey, '1');
      } catch (_e) {
        /* no sessionStorage */
      }
    }
  } catch (e) {
    // Pass the raw error (not safeLogError) to match legacy logging shape
    // — downstream observers / tests inspect the Error directly.
    pp.log('warn', M.PRE_INIT_COOKIE_READ_ERROR, e);
  }
  return ctx;
}

/**
 * Post-init step — compare current distinct_id against the pre-init value.
 * Re-identify only when the user was previously identified (not anonymous).
 */
export function applyMigrationIfNeeded(mp: MixpanelGlobal, ctx: MigrationContext): void {
  if (!pp || !ctx.preInitDistinctId) return;
  const postInitDistinctId = typeof mp.get_distinct_id === 'function' ? mp.get_distinct_id() : null;
  if (!postInitDistinctId || postInitDistinctId === ctx.preInitDistinctId) return;

  if (ctx.preInitDistinctId.indexOf('$device:') === 0) {
    pp.log('info', M.ANON_SUBDOMAIN_MIGRATED(ctx.preInitDistinctId, postInitDistinctId));
  } else {
    mp.identify(ctx.preInitDistinctId);
    pp.log('info', M.IDENTIFIED_USER_MIGRATED(ctx.preInitDistinctId));
  }
}
