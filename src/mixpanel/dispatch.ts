/**
 * Dispatch — the single HOF every Mixpanel operation routes through.
 *
 * Responsibilities (kept here so cross-cutting concerns live in ONE place):
 *   - Consent gating (track only — identity/state ops bypass consent gate,
 *     matching legacy trackFacade semantics).
 *   - Event-property enrichment for track (once, before fan-out).
 *   - Pre-init buffering when any targeted instance isn't ready yet. Buffer
 *     stores RAW args (not enriched) so enrichment re-runs at drain time
 *     with the latest builder context — matches legacy behavior where a
 *     UTM touch captured 100ms post-pageview still attaches to the buffered
 *     pageview event.
 *   - Routing rules — `alias` defaults to primary-only because Mixpanel's
 *     legacy Original-ID merge concept does not apply to Simplified ID
 *     Merge projects. Callers can override via `{ instances: ['secondary'] }`.
 *   - Per-instance error isolation — a throw on primary never blocks
 *     secondary and vice versa.
 *   - Backward-compatible boolean return — true when AT LEAST ONE targeted
 *     instance accepted the call (live dispatch OR buffered).
 */
import type { PPLib } from '@src/types/common.types';
import type {
  DispatchOptions,
  InstanceName,
  MixpanelOp,
  SharedMixpanelConfig,
} from '@src/types/mixpanel.types';
import type { MixpanelGlobal } from '@src/types/window';
import {
  allEnabledInstancesReady,
  getEnabledNames,
  getState,
} from '@src/mixpanel/instance-state';
import { drain, enqueue, setOverflowHandler } from '@src/mixpanel/pre-init-queue';
import { M } from '@src/mixpanel/messages';

// =====================================================
// MODULE WIRING (set once at boot from index.ts)
// =====================================================

let pp: PPLib | null = null;
let shared: SharedMixpanelConfig | null = null;

export function configureDispatcher(ppLib: PPLib, sharedConfig: SharedMixpanelConfig): void {
  pp = ppLib;
  shared = sharedConfig;
  setOverflowHandler((dropped) => {
    if (pp) pp.log('warn', M.PRE_INIT_QUEUE_FULL, { op: dropped.op });
  });
}

/** Test-only — re-blank module state so IIFE-reloads start clean. */
export function resetDispatcher(): void {
  pp = null;
  shared = null;
}

// =====================================================
// OP TABLE
// Maps each MixpanelOp to (a) the actual SDK invocation and (b) its
// default routing rule. Keeping the routing rule on the table itself
// (vs scattered if/else) means adding new ops is a one-line change.
// =====================================================

interface OpHandler {
  invoke: (mp: MixpanelGlobal, args: unknown[]) => void;
  /** When set, restricts default fan-out to these instances. Caller can
   *  still override via DispatchOptions.instances. */
  defaultInstances?: InstanceName[];
  /** When true, this op is consent-gated (drops silently when consent is
   *  not granted). Only `track` is gated today — matches legacy behavior. */
  consentGated?: boolean;
  /** When true, this op participates in the track-enrichment pipeline. */
  enrichable?: boolean;
}

const OP_TABLE: Record<MixpanelOp, OpHandler> = {
  track: {
    invoke: (mp, [event, props]) =>
      mp.track(event as string, (props as Record<string, unknown>) || {}),
    consentGated: true,
    enrichable: true,
  },
  identify: {
    invoke: (mp, [id]) => mp.identify(id as string),
  },
  register: {
    invoke: (mp, [props]) => mp.register(props as Record<string, unknown>),
  },
  register_once: {
    invoke: (mp, [props]) => mp.register_once(props as Record<string, unknown>),
  },
  unregister: {
    invoke: (mp, [prop]) => mp.unregister(prop as string),
  },
  alias: {
    invoke: (mp, [id, original]) =>
      // Mixpanel's alias accepts (newId) or (newId, originalId). Forward
      // the second arg only when explicitly passed to avoid handing the
      // SDK an undefined that some older builds choke on.
      original === undefined
        ? mp.alias(id as string)
        : mp.alias(id as string, original as string),
    // Excluded from secondary by default — Simplified ID Merge projects
    // do not use the legacy alias-to-merge flow.
    defaultInstances: ['primary'],
  },
  reset: {
    invoke: (mp) => mp.reset(),
  },
  opt_in_tracking: {
    invoke: (mp) => mp.opt_in_tracking(),
  },
  opt_out_tracking: {
    invoke: (mp) => mp.opt_out_tracking(),
  },
  'people.set': {
    invoke: (mp, [props]) => mp.people.set(props as Record<string, unknown>),
  },
  'people.set_once': {
    invoke: (mp, [props]) => mp.people.set_once(props as Record<string, unknown>),
  },
  'people.increment': {
    invoke: (mp, [props, by]) =>
      mp.people.increment(props as Record<string, unknown> | string, by as number | undefined),
  },
  'people.append': {
    invoke: (mp, [props]) => mp.people.append(props as Record<string, unknown>),
  },
  'people.union': {
    invoke: (mp, [props]) => mp.people.union(props as Record<string, unknown>),
  },
  'people.unset': {
    invoke: (mp, [props]) => mp.people.unset(props as string | string[]),
  },
  'people.track_charge': {
    invoke: (mp, [amount, props]) => {
      if (mp.people.track_charge) {
        mp.people.track_charge(amount as number, props as Record<string, unknown> | undefined);
      }
    },
  },
};

// =====================================================
// ENRICHMENT (track only)
// =====================================================

/**
 * Mode dispatch for the per-event property bag.
 *   'flat':   buildFlat() — flat keys only (legacy).
 *   'nested': buildNested() — page/userProperties/eventProperties/attribution.
 *   'dual':   flat keys + the 4 nested wrappers (shallow merge).
 * Returns {} when the builder is missing — defensive belt-and-braces; the
 * common module always installs it in production.
 */
function buildForMode(mode: 'flat' | 'dual' | 'nested'): Record<string, unknown> {
  if (!pp || !pp.eventPropertiesBuilder) return {};
  const builder = pp.eventPropertiesBuilder;
  if (mode === 'flat') return builder.buildFlat();
  if (mode === 'nested') return builder.buildNested();
  const flat = builder.buildFlat();
  const nested = builder.buildNested();
  const nestedKeys = Object.keys(nested);
  for (let i = 0; i < nestedKeys.length; i++) {
    flat[nestedKeys[i]] = nested[nestedKeys[i]];
  }
  return flat;
}

function enrichTrackArgs(args: unknown[]): unknown[] {
  if (!shared || !shared.enrichTrack || !pp || !pp.eventPropertiesBuilder) return args;
  const eventName = args[0];
  const callerProps = args[1] as Record<string, unknown> | undefined;
  const enriched = buildForMode(shared.emitMode);
  if (callerProps) {
    const keys = Object.keys(callerProps);
    for (let i = 0; i < keys.length; i++) {
      enriched[keys[i]] = callerProps[keys[i]];
    }
  }
  return [eventName, enriched];
}

// =====================================================
// DISPATCH
// =====================================================

/**
 * Resolve an instance's live Mixpanel handle. If state.mpRef is set
 * (normal init path), use it. Otherwise fall back to the global —
 * back-compat for callers (incl. existing tests) that install
 * window.mixpanel directly without going through init(). Auto-promotes
 * the discovered ref into state so subsequent calls skip the fallback.
 */
function resolveMpRef(name: InstanceName): MixpanelGlobal | undefined {
  const state = getState(name);
  if (state.mpRef) return state.mpRef;
  const g = typeof globalThis !== 'undefined'
    ? (globalThis as { mixpanel?: MixpanelGlobal })
    : undefined;
  if (!g || !g.mixpanel) return undefined;
  if (name === 'primary') {
    if (typeof g.mixpanel.track === 'function') {
      state.mpRef = g.mixpanel;
      state.initialized = true;
      return g.mixpanel;
    }
    return undefined;
  }
  // secondary: window.mixpanel.secondary
  const namedChildren = g.mixpanel as unknown as Record<string, MixpanelGlobal | undefined>;
  const sub = namedChildren[name];
  if (sub && typeof sub.track === 'function') {
    state.mpRef = sub;
    state.initialized = true;
    return sub;
  }
  return undefined;
}

function isReady(name: InstanceName): boolean {
  return !!resolveMpRef(name);
}

function resolveTargets(op: MixpanelOp, options?: DispatchOptions): InstanceName[] {
  const enabledNames = getEnabledNames();
  if (enabledNames.length === 0) return [];

  // Caller override wins, even over an op's defaultInstances. Filtered to
  // currently-enabled instances so a runtime setEnabled(false) silently
  // skips the disabled one rather than throwing.
  if (options && options.instances) {
    return options.instances.filter((n) => enabledNames.indexOf(n) >= 0);
  }

  const handler = OP_TABLE[op];
  if (handler && handler.defaultInstances) {
    return handler.defaultInstances.filter((n) => enabledNames.indexOf(n) >= 0);
  }

  return enabledNames;
}

/**
 * The single public entry point. Returns true when at least one targeted
 * instance accepted the call (dispatched OR buffered). False when every
 * target was disabled, the op was consent-blocked, or no instances exist.
 */
export function dispatch(op: MixpanelOp, args: unknown[], options?: DispatchOptions): boolean {
  if (!pp) return false;
  const handler = OP_TABLE[op];
  if (!handler) {
    pp.log('warn', M.UNKNOWN_DISPATCH_OP, { op });
    return false;
  }

  // Consent gate — drop silently. No log noise (would fire on every event
  // during a denied session) and no queue growth.
  if (handler.consentGated && pp.consent && !pp.consent.isGranted()) {
    return false;
  }

  // Track-specific guard: empty event name is a caller mistake; warn loud.
  if (op === 'track') {
    const eventName = args[0];
    if (typeof eventName !== 'string' || !eventName) {
      pp.log('warn', M.TRACK_EMPTY_EVENT_NAME);
      return false;
    }
  }

  const targets = resolveTargets(op, options);
  if (targets.length === 0) return false;

  // If ANY targeted instance isn't ready, buffer the whole call (RAW args
  // so enrichment re-runs at drain time with the latest builder context).
  // Disabled targets aren't waited on — `resolveTargets` already filtered
  // them out.
  const allReady = targets.every((n) => isReady(n));
  if (!allReady) {
    return enqueue({ op, args, options: options ? { ...options } : undefined });
  }

  // All targets ready — enrich once, fan out with per-instance try/catch.
  let resolvedArgs = args;
  if (handler.enrichable && !(options && options.skipEnrichment)) {
    resolvedArgs = enrichTrackArgs(args);
  }

  let anyOk = false;
  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    const mp = resolveMpRef(name);
    if (!mp) continue;
    try {
      handler.invoke(mp, resolvedArgs);
      anyOk = true;
    } catch (e) {
      pp.log('error', M.DISPATCH_ERROR, {
        op,
        instance: name,
        err: pp.safeLogError(e),
      });
    }
  }
  return anyOk;
}

// =====================================================
// PRE-INIT QUEUE DRAIN
// Called from the loaded-callback orchestrator (index.ts) once all
// enabled instances have reported ready. Replays buffered ops through
// the normal dispatch path so enrichment + routing apply uniformly.
// =====================================================

export function drainIfReady(): void {
  if (!pp) return;
  if (!allEnabledInstancesReady()) return;
  const entries = drain();
  if (entries.length === 0) return;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    dispatch(entry.op, entry.args, entry.options);
  }
  pp.log('info', M.PRE_INIT_DRAINED(entries.length));
}
