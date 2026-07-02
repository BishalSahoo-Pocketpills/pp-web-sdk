/**
 * Shared-context registration — base props, cookie identity, experiments,
 * marketing attribution, VWO bridge. Run ONCE after both instances are
 * loaded so every super-prop registration fans out to both projects
 * uniformly via dispatch.
 *
 * Per-instance label: the `project` super-prop is the one place we DO
 * want a different value on each instance. Handled separately in the
 * loaded callback (index.ts) rather than this shared pass.
 */
import type { PPLib } from '@src/types/common.types';
import type { MixpanelCookieNames } from '@src/types/mixpanel.types';
import { isValidUserId, isLoggedIn } from '@src/common/auth';
import { pollUntil } from '@src/common/retry';
import { isAuthenticated } from '@src/mixpanel/auth-state';
import { dispatch } from '@src/mixpanel/dispatch';
import { getState } from '@src/mixpanel/instance-state';
import { registerCampaignParams } from '@src/mixpanel/campaign';
import { resyncAfterReset } from '@src/mixpanel/identity-sync';
import { COOKIE_KEYS, DEFAULTS, M } from '@src/mixpanel/messages';

const VWO_BRIDGE_POLL_MAX_ATTEMPTS = DEFAULTS.VWO_BRIDGE_POLL_MAX_ATTEMPTS;
const VWO_BRIDGE_POLL_INTERVAL_MS = DEFAULTS.VWO_BRIDGE_POLL_INTERVAL_MS;

let pp: PPLib | null = null;
let cookieNames: MixpanelCookieNames | null = null;

export function configureSharedContext(ppLib: PPLib, cookies: MixpanelCookieNames): void {
  pp = ppLib;
  cookieNames = cookies;
}


export function registerSharedContext(win: Window & typeof globalThis, doc: Document): void {
  if (!pp || !cookieNames) return;
  registerBaseProps(win);
  registerCookieIdentity();
  registerAuthState();
  registerExperimentCookie();
  registerCampaignParams(doc);
  registerMarketingAttribution();
  unifyDistinctIdWithPpDistinctId();
  bridgeVwoProps(win);
}

function registerBaseProps(win: Window & typeof globalThis): void {
  // `session ID` / `last event time` super-props were removed — they
  // duplicated pp_session_id (event property from event-properties-builder)
  // and drifted because each was generated independently. pp_session_id
  // is the single source of truth for session identity on Mixpanel events.
  dispatch('register', [
    {
      pp_user_agent: win.navigator.userAgent,
    },
  ]);
}

function registerCookieIdentity(): void {
  if (!pp || !cookieNames) return;
  const userId = pp.getCookie(cookieNames.userId) ?? '';
  /*! v8 ignore start */
  if (isValidUserId(userId)) {
  /*! v8 ignore stop */
    dispatch('register', [{ pp_user_id: userId }]);
  }

  const ipAddress = pp.getCookie(cookieNames.ipAddress);
  /*! v8 ignore start */
  if (ipAddress) {
  /*! v8 ignore stop */
    dispatch('register', [{ pp_user_ip: ipAddress }]);
  }
}

function registerAuthState(): void {
  if (!pp || !pp.eventPropertiesBuilder) return;
  try {
    const bundle = pp.eventPropertiesBuilder.build();
    const appIsAuthenticated = bundle.eventProperties.app_is_authenticated;
    dispatch('register', [{ app_is_authenticated: appIsAuthenticated }]);
    if (isAuthenticated(pp)) {
      dispatch('people.set', [{ app_is_authenticated: appIsAuthenticated }]);
    }
  } catch {
    // defensive: skip if builder fails
  }
}

function registerExperimentCookie(): void {
  if (!pp || !cookieNames) return;
  const expCookie = pp.getCookie(cookieNames.experiments);
  /*! v8 ignore start */
  if (!expCookie) return;
  /*! v8 ignore stop */
  const expJson = pp.Security.json.parse(expCookie);
  /*! v8 ignore start */
  if (!expJson || typeof expJson !== 'object') return;
  /*! v8 ignore stop */
  const expObj = expJson as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  Object.keys(expObj).forEach(function (item: string) {
    data[item] = expObj[item];
  });
  // Profile writes are gated on authentication per Mixpanel's Simplified
  // ID Merge guidance — see auth-state.ts for the rationale. The
  // super-property `register` below stays unconditional because it
  // attaches to events going forward, not to a profile.
  if (isAuthenticated(pp)) {
    dispatch('people.set_once', [data]);
  }
  dispatch('register', [data]);
}

function registerMarketingAttribution(): void {
  if (!pp || !pp.eventPropertiesBuilder) return;
  try {
    const marketingAttribution = pp.eventPropertiesBuilder.getMarketingAttribution();
    if (marketingAttribution) {
      dispatch('register', [{ marketingAttribution: marketingAttribution }]);
      // Profile write gated on authentication — see auth-state.ts. Super-
      // property `register` above stays unconditional so anonymous events
      // still carry the marketingAttribution column.
      if (isAuthenticated(pp)) {
        dispatch('people.set', [{ marketingAttribution: marketingAttribution }]);
      }
      pp.log('info', M.MARKETING_ATTR_REGISTERED);
    }
  } catch (e) {
    pp.log('warn', M.MARKETING_ATTR_FAILED, e);
  }
}

/**
 * Unify Mixpanel's distinct_id with the SDK's pp_distinct_id ONLY for
 * authenticated visitors. Per Mixpanel's Simplified ID Merge guidance,
 * anonymous visitors must keep the auto-generated `$device:<uuid>`
 * distinct_id Mixpanel mints at SDK init. Calling `identify()` for an
 * anonymous visitor creates a real Mixpanel user profile keyed by their
 * device_id — this inflates user counts (every anonymous visitor counts
 * as a unique user) and forces a redundant profile-merge step when the
 * same visitor later authenticates.
 *
 * Anonymous flow (correct per Mixpanel):
 *   - distinct_id = `$device:<uuid>` (auto-generated by mp.init)
 *   - $user_id    = undefined
 *   - No `identify()` call
 *
 * Authenticated flow:
 *   1. Identify primary to the real pp_user_id (single instance —
 *      secondary was already identified by syncIdentityFromPrimary in
 *      its loaded callback, possibly to primary's OLD distinct_id).
 *   2. Resync secondary from primary so it picks up the NEW canonical id.
 *   3. Mixpanel's Simplified ID Merge auto-merges the anonymous
 *      `$device:<uuid>` profile with the new identified profile.
 *
 * Skips the dispatched identify when Mixpanel's current distinct_id
 * already matches (prevents redundant identify() on every page load).
 */
function unifyDistinctIdWithPpDistinctId(): void {
  if (!pp || !pp.eventPropertiesBuilder) return;
  try {
    const bundle = pp.eventPropertiesBuilder.build();

    // Anonymous visitors: do nothing. Mixpanel's auto-generated
    // `$device:<uuid>` distinct_id is the correct anonymous state per
    // Simplified ID Merge. The previous behavior of identifying anonymous
    // visitors with their device_id (so pp_distinct_id == device_id ==
    // distinct_id == $user_id) created premature user profiles and is
    // explicitly discouraged by Mixpanel.
    if (!isLoggedIn(bundle.eventProperties.logged_in as string)) return;

    const ppDistinctId = bundle.userProperties.pp_distinct_id;
    if (!isValidUserId(ppDistinctId)) return;

    const primary = getState('primary');
    const currentMpId =
      primary.mpRef && typeof primary.mpRef.get_distinct_id === 'function'
        ? primary.mpRef.get_distinct_id()
        : null;
    if (currentMpId === ppDistinctId) return;

    // Primary first — single call. The instances:['primary'] scope is
    // what eliminates the double-identify on secondary.
    dispatch('identify', [ppDistinctId], { instances: ['primary'] });
    // Then mirror to secondary (if enabled and loaded). resyncAfterReset
    // reads primary's now-canonical distinct_id and applies it to
    // secondary in one call — same path used after `reset()`. No-op
    // when secondary is disabled or not yet ready.
    resyncAfterReset();
    pp.log('info', M.DISTINCT_ID_UNIFIED(currentMpId as string | null, ppDistinctId));
    // Fire after both instances are synced so distinct_id == userId on
    // the event. identify() is synchronous for state so no queue-drain
    // is needed before this track call.
    pp.mixpanel?.track('identity_submitted', {});
  } catch (e) {
    pp.log('warn', M.DISTINCT_ID_UNIFICATION_FAILED, e);
  }
}

/**
 * Bridge VWO experiment properties → Mixpanel super-properties so they
 * appear on every subsequent event (page view, add to cart, purchase).
 * Reads from ppLib (set by VWO module) or sessionStorage (persisted).
 * Polls + uses VWO's queue callback because VWO and Mixpanel race at boot.
 */
function bridgeVwoProps(win: Window & typeof globalThis): void {
  if (!pp) return;
  let registered = false;
  let poll: { cancel: () => void } | null = null;

  function readVWOProps(): Record<string, string> | null {
    if (!pp) return null;
    const props = pp._vwoExperimentProps;
    if (props && typeof props === 'object') return props;
    try {
      const stored = win.sessionStorage.getItem(COOKIE_KEYS.VWO_PROPS);
      if (stored) {
        const parsed = pp.Security.json.parse(stored);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
      }
    } catch (_e) {
      /* no sessionStorage */
    }
    return null;
  }

  function registerVWOProps(): boolean {
    if (registered) return true;
    if (!pp) return false;
    try {
      const props = readVWOProps();
      if (props) {
        const okRegister = dispatch('register', [props]);
        // Profile write gated on authentication — see auth-state.ts. For
        // anonymous visitors we treat the people.set as a no-op success so
        // the bridge still flips `registered = true` and stops polling.
        // The super-property `register` above already carries the
        // experiment exposure to every event, which is what downstream
        // segmentation actually needs.
        const okPeopleSet = isAuthenticated(pp) ? dispatch('people.set', [props]) : true;
        // Dispatch swallows per-instance throws internally (so primary
        // failure doesn't block secondary). Surface a combined failure as
        // warn here for back-compat with the legacy single-instance log
        // contract — downstream observers / tests assert this exact
        // ('warn', 'Failed to register VWO experiment properties', Error)
        // triple. dispatch already logged the per-instance error detail
        // at 'error' level, so this surfacing layer is purely about the
        // top-level observability signal.
        if (!okRegister || !okPeopleSet) {
          // EITHER call failing is worth surfacing — matches legacy
          // single-instance semantics where one throw aborted the whole
          // bridge. dispatch already logged the underlying per-instance
          // error at 'error' level; this is the top-level signal.
          pp.log(
            'warn',
            M.VWO_PROPS_FAILED,
            new Error('dispatch returned false for register or people.set'),
          );
          return false;
        }
        registered = true;
        pp.log('info', M.VWO_PROPS_REGISTERED);
        if (poll) {
          poll.cancel();
          poll = null;
        }
        return true;
      }
    } catch (e) {
      // Pass raw error (not safeLogError) — legacy log shape downstream
      // observers / tests inspect.
      pp.log('warn', M.VWO_PROPS_FAILED, e);
    }
    return false;
  }

  // Try immediately — VWO may have already set props.
  registerVWOProps();

  if (!registered) {
    // Strategy 1: VWO queue callback.
    win._vis_opt_queue = win._vis_opt_queue || [];
    win._vis_opt_queue.push(function () {
      registerVWOProps();
    });

    // Strategy 2: Poll for ppLib._vwoExperimentProps.
    poll = pollUntil({
      check: registerVWOProps,
      intervalMs: VWO_BRIDGE_POLL_INTERVAL_MS,
      maxAttempts: VWO_BRIDGE_POLL_MAX_ATTEMPTS,
      win,
    });
  }
}

/** Per-instance project name registration. Called from the loaded
 *  callback for each instance so primary and secondary can report
 *  different `project` super-prop values. */
export function registerProjectName(instances: ('primary' | 'secondary')[], projectName: string): void {
  if (!projectName) return;
  dispatch('register', [{ project: projectName }], { instances });
}
