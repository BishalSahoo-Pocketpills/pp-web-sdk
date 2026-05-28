/**
 * Mixpanel session boundary detector.
 *
 * **Single source of truth: `pp_analytics_session_id` cookie**, owned by
 * `src/common/session.ts` and surfaced in events as the `pp_session_id`
 * event property by the event-properties-builder. The `session ID` and
 * `last event time` super-properties that this module USED to register
 * have been removed — they duplicated `pp_session_id` and drifted because
 * each was generated independently.
 *
 * This module's only remaining job is detecting a session boundary so
 * `resetSessionCampaign` can clear stale last-touch UTM super-props on
 * the new session. It tracks the previously-seen session ID locally and
 * fires on first change.
 *
 * `makeTrackWrapper(state)` returns a per-instance wrapper that runs
 * `SessionManager.check()` before forwarding to the underlying SDK. The
 * `_ppOriginal` augmentation prevents wrapper nesting if init runs twice.
 */
import type { PPLib } from '@src/types/common.types';
import type { InstanceName } from '@src/types/mixpanel.types';
import type { MixpanelGlobal } from '@src/types/window';
import type { InstanceState } from '@src/mixpanel/instance-state';
import { DEFAULTS, M } from '@src/mixpanel/messages';

let pp: PPLib | null = null;
let timeoutMs: number = DEFAULTS.SESSION_TIMEOUT_MS;
let lastSeenSessionId: string | null = null;

export function configureSession(ppLib: PPLib, sessionTimeout: number): void {
  pp = ppLib;
  timeoutMs = sessionTimeout > 0 ? sessionTimeout : DEFAULTS.SESSION_TIMEOUT_MS;
}

export function resetSession(): void {
  pp = null;
  lastSeenSessionId = null;
  timeoutMs = DEFAULTS.SESSION_TIMEOUT_MS;
}

/**
 * Pull the current session ID from the SDK's common session service —
 * the single source of truth. Returns null when ppLib or its session
 * service is missing (boot ordering / minimal deployments).
 */
function readCommonSessionId(): string | null {
  if (pp === null) return null;
  if (typeof pp.session?.getOrCreateSessionId !== 'function') return null;
  try {
    const id = pp.session.getOrCreateSessionId();
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Check whether common's session has rotated since the last call.
 * Returns true ONLY on a true boundary (the ID changed). First call
 * (initial adoption) returns false — that's not a boundary.
 *
 * Caller — the track wrapper — uses the return value to trigger
 * resetCampaign so stale last-touch UTM super-props don't leak across
 * sessions.
 */
function check(): boolean {
  const commonId = readCommonSessionId();
  if (commonId === null) return false;
  if (lastSeenSessionId === commonId) return false;
  const isFirstCheck = lastSeenSessionId === null;
  lastSeenSessionId = commonId;
  return !isFirstCheck;
}

export const SessionManager = {
  get timeout(): number {
    return timeoutMs;
  },
  set timeout(value: number) {
    timeoutMs = value > 0 ? value : DEFAULTS.SESSION_TIMEOUT_MS;
  },
  getSessionId: (): string | null => lastSeenSessionId,
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

// Re-export InstanceName so type-only consumers can pull from one place.
export type { InstanceName };
