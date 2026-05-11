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
  configure(opts: Partial<ConsentConfig>): void;
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

  return {
    isGranted,
    status,
    grant: () => persist('granted'),
    revoke: () => persist('denied'),
    configure: (opts: Partial<ConsentConfig>) => {
      if (opts.mode === 'opt-in' || opts.mode === 'opt-out') config.mode = opts.mode;
      if (typeof opts.storageKey === 'string' && opts.storageKey) config.storageKey = opts.storageKey;
    }
  };
}
