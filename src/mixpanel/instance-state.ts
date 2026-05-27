/**
 * Per-instance state registry + namespaced facade factory.
 *
 * Both primary and secondary Mixpanel instances live in the same module-
 * scoped STATE map. The dispatcher reads from it, the loader/identity-sync
 * modules write into it. Tests reset it via `resetInstanceState()` to keep
 * IIFE-loaded test files isolated (pool: 'forks' helps but doesn't cover
 * within-file resets).
 */
import type {
  DualMixpanelConfig,
  InstanceName,
  MixpanelInstanceConfig,
  MixpanelInstanceFacade,
} from '@src/types/mixpanel.types';
import type { MixpanelGlobal } from '@src/types/window';
import { cloneConfig } from '@src/common/clone-config';

export interface InstanceState {
  name: InstanceName;
  config: MixpanelInstanceConfig;
  /** Runtime toggle — mutable via `setEnabled`. Distinct from `config.enabled`
   *  which captures the boot value; runtime flips don't write back to config
   *  so `getConfig()` always reports the static deploy-time intent. */
  enabled: boolean;
  initialized: boolean;
  /** Whether `mp.init(token, opts, name)` has actually been called against
   *  the shared loader stub. Used by the loader to avoid double-init. */
  initCalled: boolean;
  /** Resolved Mixpanel handle. For primary this is `win.mixpanel`; for
   *  secondary it's `win.mixpanel.secondary` (or undefined until loaded). */
  mpRef: MixpanelGlobal | undefined;
}

const ORDER: InstanceName[] = ['primary', 'secondary'];

const STATE: Record<InstanceName, InstanceState> = {
  primary: makeBlankState('primary'),
  secondary: makeBlankState('secondary'),
};

function makeBlankState(name: InstanceName): InstanceState {
  return {
    name,
    config: { enabled: name === 'primary', token: '' },
    enabled: name === 'primary',
    initialized: false,
    initCalled: false,
    mpRef: undefined,
  };
}

export function getState(name: InstanceName): InstanceState {
  return STATE[name];
}

export function getAllStates(): InstanceState[] {
  return ORDER.map((n) => STATE[n]);
}

export function getEnabledStates(): InstanceState[] {
  return ORDER.map((n) => STATE[n]).filter((s) => s.enabled);
}

/** Returns the names of instances currently enabled, in canonical order. */
export function getEnabledNames(): InstanceName[] {
  return ORDER.filter((n) => STATE[n].enabled);
}

/** Reset both instances to blank state. Test-only — production never calls. */
export function resetInstanceState(): void {
  STATE.primary = makeBlankState('primary');
  STATE.secondary = makeBlankState('secondary');
}

/** Apply a DualMixpanelConfig to the state registry. Called from `configure()`
 *  and again right before `init()` in case the caller layered later overrides. */
export function applyDualConfig(cfg: DualMixpanelConfig): void {
  STATE.primary.config = cfg.primary;
  STATE.primary.enabled = !!cfg.primary.enabled;
  STATE.secondary.config = cfg.secondary;
  STATE.secondary.enabled = !!cfg.secondary.enabled;
}

export function setEnabled(name: InstanceName, enabled: boolean): void {
  STATE[name].enabled = !!enabled;
}

export function isInstanceReady(name: InstanceName): boolean {
  const s = STATE[name];
  return s.initialized && !!s.mpRef;
}

/**
 * Returns true when every ENABLED instance has loaded its real Mixpanel
 * SDK. Disabled instances are ignored (we don't wait for them). Used by
 * the pre-init queue to decide when to drain.
 */
export function allEnabledInstancesReady(): boolean {
  const enabled = getEnabledStates();
  if (enabled.length === 0) return false;
  return enabled.every((s) => s.initialized && !!s.mpRef);
}

/**
 * Build the per-instance facade exposed at `ppLib.mixpanel.primary` /
 * `ppLib.mixpanel.secondary`. Takes a `dispatcher` callback so this module
 * stays free of a hard dependency on `dispatch.ts` (otherwise we'd get a
 * cycle: dispatch reads STATE, STATE imports dispatch for facade methods).
 */
export function makeInstanceFacade(
  name: InstanceName,
  dispatcher: (op: string, args: unknown[], options: { instances: InstanceName[] }) => boolean,
): MixpanelInstanceFacade {
  const only = { instances: [name] };
  return {
    track: (event, properties) => dispatcher('track', [event, properties], only),
    identify: (id) => dispatcher('identify', [id], only),
    register: (props) => dispatcher('register', [props], only),
    register_once: (props) => dispatcher('register_once', [props], only),
    unregister: (prop) => dispatcher('unregister', [prop], only),
    alias: (id, original) => dispatcher('alias', [id, original], only),
    reset: () => dispatcher('reset', [], only),
    opt_in_tracking: () => dispatcher('opt_in_tracking', [], only),
    opt_out_tracking: () => dispatcher('opt_out_tracking', [], only),
    people: {
      set: (props) => dispatcher('people.set', [props], only),
      set_once: (props) => dispatcher('people.set_once', [props], only),
      increment: (props, by) => dispatcher('people.increment', [props, by], only),
      append: (props) => dispatcher('people.append', [props], only),
      union: (props) => dispatcher('people.union', [props], only),
      unset: (props) => dispatcher('people.unset', [props], only),
      track_charge: (amount, props) => dispatcher('people.track_charge', [amount, props], only),
    },
    setEnabled: (enabled) => setEnabled(name, enabled),
    isEnabled: () => STATE[name].enabled,
    getConfig: () => JSON.parse(JSON.stringify(STATE[name].config)) as MixpanelInstanceConfig,
    getCookieData: () => readCookieDataForToken(STATE[name].config.token),
  };
}

/**
 * Read the Mixpanel cookie scoped to a specific token. Used by the per-
 * instance facade so callers can pull state out of either project without
 * relying on the legacy single-cookie reader (which only matched whichever
 * cookie was iterated last when both projects were configured).
 */
function readCookieDataForToken(token: string): Record<string, unknown> {
  if (!token || typeof document === 'undefined') return {};
  const targetName = 'mp_' + token + '_mixpanel';
  try {
    const pairs = document.cookie.split(/\s*;\s*/);
    for (let i = 0; i < pairs.length; i++) {
      const parts = pairs[i].split(/\s*=\s*/);
      const name = decodeURIComponent(parts[0]);
      if (name === targetName) {
        const value = decodeURIComponent(parts.slice(1).join('='));
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
        } catch (_e) {
          return {};
        }
      }
    }
  } catch (_e) {
    return {};
  }
  return {};
}
