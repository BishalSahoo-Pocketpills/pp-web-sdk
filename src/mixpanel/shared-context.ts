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
import { pollUntil } from '@src/common/retry';
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
  registerExperimentCookie();
  registerCampaignParams(doc);
  registerMarketingAttribution();
  unifyDistinctIdWithPpDistinctId();
  bridgeVwoProps(win);
}

function registerBaseProps(win: Window & typeof globalThis): void {
  dispatch('register', [
    {
      'last event time': Date.now(),
      pp_user_agent: win.navigator.userAgent,
    },
  ]);
}

function registerCookieIdentity(): void {
  if (!pp || !cookieNames) return;
  const userId = pp.getCookie(cookieNames.userId);
  /*! v8 ignore start */
  if (userId) {
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
  dispatch('people.set_once', [data]);
  dispatch('register', [data]);
}

function registerMarketingAttribution(): void {
  if (!pp || !pp.eventPropertiesBuilder) return;
  try {
    const marketingAttribution = pp.eventPropertiesBuilder.getMarketingAttribution();
    if (marketingAttribution) {
      dispatch('register', [{ marketingAttribution: marketingAttribution }]);
      dispatch('people.set', [{ marketingAttribution: marketingAttribution }]);
      pp.log('info', M.MARKETING_ATTR_REGISTERED);
    }
  } catch (e) {
    pp.log('warn', M.MARKETING_ATTR_FAILED, e);
  }
}

/**
 * Unify Mixpanel's distinct_id with the SDK's pp_distinct_id so cross-tool
 * reports (Mixpanel ↔ Braze ↔ GA4) join cleanly without translation.
 * Reads primary's current distinct_id; skips the dispatched identify when
 * it already matches. Without this short-circuit a fresh identify() fires
 * on every page load and pollutes the Mixpanel ingest with redundant calls.
 *
 * Identity sync is primary-then-mirror, not dual-write:
 *   1. Identify primary to ppDistinctId (single instance — secondary was
 *      already identified by syncIdentityFromPrimary in its loaded
 *      callback, possibly to primary's OLD distinct_id).
 *   2. Resync secondary from primary so it picks up the NEW canonical id.
 *
 * Pre-fix this dispatched `identify` to both instances by default. That
 * worked, but secondary received two identify() calls within ~100ms of
 * its loaded callback (once via syncIdentityFromPrimary, once via this
 * unify pass) — redundant and noisy in Mixpanel's debug view.
 */
function unifyDistinctIdWithPpDistinctId(): void {
  if (!pp || !pp.eventPropertiesBuilder) return;
  try {
    const bundle = pp.eventPropertiesBuilder.build();
    const ppDistinctId = bundle.userProperties.pp_distinct_id;
    if (typeof ppDistinctId !== 'string' || ppDistinctId.length === 0) return;

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
        const okPeopleSet = dispatch('people.set', [props]);
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
