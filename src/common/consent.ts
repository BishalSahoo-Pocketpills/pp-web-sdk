/**
 * pp-web-sdk: Unified consent service.
 *
 * Sits ABOVE individual SDK opt-out toggles (Mixpanel's `optOutByDefault`,
 * Braze's session gate). Dispatch sites in mixpanel/ecommerce/event-source/
 * vwo/datalayer call `ppLib.consent.isGranted()` before sending an event;
 * a denial drops the event silently (no log noise, no queue accumulation).
 *
 * Resolution order:
 *   1. If `win.ppAnalytics.consent.status` is wired up (the customer's
 *      ppAnalytics module owns consent UX), delegate to it. Single source
 *      of truth.
 *   2. localStorage `pp_consent` — `'denied'` blocks, anything else allows
 *      under the default. Honours an explicit user choice persisted by a
 *      cookie banner.
 *   3. Default: `mode === 'opt-in'` → blocks until granted; `'opt-out'`
 *      (default) → allows until revoked. Matches GDPR "default-deny" if a
 *      customer flips the mode flag for EU traffic.
 *
 * NOT a cookie banner. NOT a GPC parser. Customers wire their own UX into
 * `grant()` / `revoke()` from a banner or framework integration.
 */

import type { PPLib } from '@src/types/common.types';
import type { DeepPartial } from '@src/types/utility.types';

export type ConsentMode = 'opt-in' | 'opt-out';
export type ConsentStatus = 'granted' | 'denied' | 'unknown';

export interface ConsentConfig {
  mode: ConsentMode;
  storageKey: string;
}

export interface ConsentService {
  isGranted(): boolean;
  status(): ConsentStatus;
  grant(): void;
  revoke(): void;
  configure(opts: DeepPartial<ConsentConfig>): void;
  /**
   * Subscribe to post-boot consent CHANGES (an explicit grant()/revoke()).
   * Modules (e.g. Mixpanel) use this to propagate a mid-session CMP revoke to
   * native opt-out, since the boot-time consent check only runs once. The
   * callback receives the new status. Returns an unsubscribe function.
   * Note: configure() mode changes are a setup-time concern and are NOT
   * emitted — only explicit grant()/revoke() consent actions are.
   */
  subscribe(listener: (status: ConsentStatus) => void): () => void;
}

interface PpAnalyticsLike {
  consent?: {
    status?: () => boolean;
  };
}

const DEFAULT_CONFIG: ConsentConfig = {
  mode: 'opt-out',
  storageKey: 'pp_consent'
};

export function createConsentService(
  win: Window & typeof globalThis,
  ppLib: PPLib
): ConsentService {
  const config: ConsentConfig = { ...DEFAULT_CONFIG };
  const listeners: Array<(status: ConsentStatus) => void> = [];
  // Last explicit choice (grant/revoke), used as an in-memory fallback in
  // status() when persistence is blocked. Last status delivered to listeners,
  // used to dedupe redundant notifications.
  let lastExplicit: ConsentStatus | null = null;
  let lastNotified: ConsentStatus | null = null;

  function notify(next: ConsentStatus): void {
    // Snapshot so an unsubscribe mid-dispatch can't skip a sibling, and isolate
    // each listener — a throwing subscriber must not break consent persistence
    // or starve the others.
    const snapshot = listeners.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](next);
      } catch (e) {
        ppLib.log('error', '[ppConsent] consent listener threw', ppLib.safeLogError(e));
      }
    }
  }

  function subscribe(listener: (status: ConsentStatus) => void): () => void {
    listeners.push(listener);
    return function unsubscribe(): void {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function readDelegated(): ConsentStatus {
    try {
      const ppAnalytics = (win as unknown as { ppAnalytics?: PpAnalyticsLike }).ppAnalytics;
      if (ppAnalytics && ppAnalytics.consent && typeof ppAnalytics.consent.status === 'function') {
        return ppAnalytics.consent.status() ? 'granted' : 'denied';
      }
    } catch (e) {
      // ppAnalytics not present or threw — fall through
    }
    return 'unknown';
  }

  function readStored(): ConsentStatus {
    try {
      const raw = win.localStorage.getItem(config.storageKey);
      if (raw === 'denied') return 'denied';
      if (raw === 'granted' || raw === 'approved') return 'granted';
    } catch (e) {
      // localStorage unavailable
    }
    return 'unknown';
  }

  function status(): ConsentStatus {
    const delegated = readDelegated();
    if (delegated !== 'unknown') return delegated;
    const stored = readStored();
    if (stored !== 'unknown') return stored;
    // In-memory fallback: an explicit grant()/revoke() whose persist() failed
    // (blocked localStorage) must still be authoritative for the rest of the
    // page — otherwise a revoke that couldn't write would read back as the
    // mode default and silently reopen the gate.
    if (lastExplicit !== null) return lastExplicit;
    return config.mode === 'opt-in' ? 'denied' : 'granted';
  }

  function isGranted(): boolean {
    return status() === 'granted';
  }

  function persist(value: 'granted' | 'denied'): void {
    try {
      win.localStorage.setItem(config.storageKey, value);
    } catch (e) {
      ppLib.log('warn', '[ppConsent] localStorage unavailable; consent state will not persist across pages');
    }
  }

  // Emit the RESOLVED status (not the raw grant/revoke value) so a listener that
  // aligns native opt-state with consent stays consistent with isGranted() even
  // when ppAnalytics delegation or mode overrides the explicit call (e.g. a
  // grant() while delegation says denied must NOT opt the user in). Deduped on
  // unchanged status to avoid redundant native opt-in/out churn and log spam.
  function emitChange(): void {
    const next = status();
    if (next === lastNotified) return;
    lastNotified = next;
    notify(next);
  }

  function grant(): void {
    lastExplicit = 'granted';
    persist('granted');
    emitChange();
  }

  function revoke(): void {
    lastExplicit = 'denied';
    persist('denied');
    emitChange();
  }

  return {
    isGranted,
    status,
    grant,
    revoke,
    subscribe,
    configure: (opts: DeepPartial<ConsentConfig>) => {
      if (opts.mode === 'opt-in' || opts.mode === 'opt-out') config.mode = opts.mode;
      if (typeof opts.storageKey === 'string' && opts.storageKey) config.storageKey = opts.storageKey;
    }
  };
}
