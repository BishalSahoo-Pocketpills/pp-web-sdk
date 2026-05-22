/**
 * Session management — ONE shared session ID across both instances.
 *
 * Two projects reporting different session IDs for the same user activity
 * would make cross-project parity validation impossible. The SessionManager
 * owns the canonical session ID and last-event timestamp; both values fan
 * out to every enabled instance via dispatch.register, so each Mixpanel
 * project gets identical session super-props.
 *
 * `makeTrackWrapper(state)` returns a per-instance wrapper that runs
 * `SessionManager.check()` before forwarding to the underlying SDK. The
 * `_ppOriginal` augmentation prevents wrapper nesting if init runs twice.
 */
import type { PPLib } from '@src/types/common.types';
import type { InstanceName } from '@src/types/mixpanel.types';
import type { MixpanelGlobal } from '@src/types/window';
import type { InstanceState } from '@src/mixpanel/instance-state';
import { getState } from '@src/mixpanel/instance-state';
import { dispatch } from '@src/mixpanel/dispatch';
import { DEFAULTS, M } from '@src/mixpanel/messages';

let pp: PPLib | null = null;
let timeoutMs: number = DEFAULTS.SESSION_TIMEOUT_MS;
let sessionId: string | null = null;
let lastEventTime = 0;

export function configureSession(ppLib: PPLib, sessionTimeout: number): void {
  pp = ppLib;
  timeoutMs = sessionTimeout > 0 ? sessionTimeout : DEFAULTS.SESSION_TIMEOUT_MS;
}

export function resetSession(): void {
  pp = null;
  sessionId = null;
  lastEventTime = 0;
  timeoutMs = DEFAULTS.SESSION_TIMEOUT_MS;
}

function generateId(): string {
  function s4(): string {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

/**
 * Mint a fresh session ID and fan it out to every enabled instance. Also
 * registers `last event time` so the next session-timeout check has a
 * baseline. Called from `check()` when no session is active OR when the
 * idle timeout has elapsed.
 */
function setId(): void {
  sessionId = generateId();
  lastEventTime = Date.now();
  dispatch('register', [{ 'session ID': sessionId, 'last event time': lastEventTime }]);
}

/**
 * Read the latest session state from primary's super-props. Mixpanel
 * persists super-props across page loads via its cookie, so primary's
 * get_property('session ID' / 'last event time') is the authoritative
 * source of truth between checks. Internal SessionManager state is a
 * write-back cache — we mirror writes there for fan-out efficiency, but
 * we re-read primary on each check so external mutations (cookie
 * persistence, debug-console overrides) are honored.
 */
function readPrimarySuperProps(): { id: string | null; last: number | null } {
  const primary = getState('primary');
  if (!primary.mpRef || typeof primary.mpRef.get_property !== 'function') {
    return { id: null, last: null };
  }
  try {
    const existingId = primary.mpRef.get_property('session ID');
    const existingLast = primary.mpRef.get_property('last event time');
    return {
      id: typeof existingId === 'string' && existingId.length > 0 ? existingId : null,
      last: typeof existingLast === 'number' && existingLast > 0 ? existingLast : null,
    };
  } catch (_e) {
    return { id: null, last: null };
  }
}

/**
 * Check / refresh the session. Idempotent — safe to call before every
 * track. Triggers a session reset when the configured idle timeout has
 * elapsed since the last event.
 *
 * Returns true when a new session ID was minted in this call (caller —
 * the SessionManager itself — uses this to trigger resetCampaign on
 * session boundaries).
 */
function check(): boolean {
  const now = Date.now();
  const primaryProps = readPrimarySuperProps();
  // Adopt session ID from primary if internal state is blank.
  if (!sessionId && primaryProps.id) {
    sessionId = primaryProps.id;
  }
  // Last event time — prefer primary's super-prop when available; falls
  // back to internal state. Lets external mutations (test cookie writes,
  // debug overrides) drive timeout detection.
  const effectiveLast = primaryProps.last !== null ? primaryProps.last : lastEventTime;

  if (!sessionId) {
    setId();
    return true;
  }
  if (effectiveLast && now - effectiveLast > timeoutMs) {
    setId();
    return true;
  }
  lastEventTime = now;
  dispatch('register', [{ 'last event time': now }]);
  return false;
}

export const SessionManager = {
  get timeout(): number {
    return timeoutMs;
  },
  set timeout(value: number) {
    timeoutMs = value > 0 ? value : DEFAULTS.SESSION_TIMEOUT_MS;
  },
  getSessionId: (): string | null => sessionId,
  generateId,
  setId,
  check,
};

// =====================================================
// PER-INSTANCE TRACK MONKEY-PATCH
// Each named Mixpanel instance has its own `track` function. We wrap each
// to run SessionManager.check() first so session-timeout detection fires
// regardless of which instance the caller landed on. `_ppOriginal` prevents
// wrapper nesting across re-inits.
// =====================================================

type AugmentedTrack = MixpanelGlobal['track'] & {
  _ppOriginal?: MixpanelGlobal['track'];
};

/**
 * `onSessionBoundary` is invoked when SessionManager.check() returns true
 * (a new session was minted). Index.ts passes resetCampaign so attribution
 * super-props reset on session boundary, matching legacy behavior.
 */
export function makeTrackWrapper(
  state: InstanceState,
  onSessionBoundary?: () => void,
): MixpanelGlobal['track'] | null {
  if (!state.mpRef) return null;
  const mp = state.mpRef;
  const augmented = mp.track as AugmentedTrack;
  const originalTrack: MixpanelGlobal['track'] = augmented._ppOriginal || mp.track;

  const wrapped: AugmentedTrack = function (this: MixpanelGlobal, ...args: unknown[]): void {
    const wasReset = SessionManager.check();
    if (wasReset && onSessionBoundary) {
      try {
        onSessionBoundary();
      } catch (e) {
        if (pp) pp.log('warn', M.SESSION_BOUNDARY_HANDLER_ERROR, pp.safeLogError(e));
      }
    }
    (originalTrack as (...a: unknown[]) => void).apply(mp, args);
  } as AugmentedTrack;
  wrapped._ppOriginal = originalTrack;
  return wrapped;
}

/** Apply the wrapper to a specific instance's `mp.track`. Idempotent —
 *  re-wrapping uses the stored `_ppOriginal` so the wrapper depth stays 1. */
export function patchInstanceTrack(
  state: InstanceState,
  onSessionBoundary?: () => void,
): boolean {
  if (!state.mpRef) return false;
  const wrapped = makeTrackWrapper(state, onSessionBoundary);
  if (!wrapped) return false;
  state.mpRef.track = wrapped;
  return true;
}

/** Test-only — return current internal state for assertions. */
export function _internals(): { sessionId: string | null; lastEventTime: number; timeoutMs: number } {
  return { sessionId, lastEventTime, timeoutMs };
}

// Re-export InstanceName so type-only consumers can pull from one place.
export type { InstanceName };
