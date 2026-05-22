/**
 * Dispatch — the single HOF every Mixpanel operation routes through.
 *
 * Responsibilities (kept here so cross-cutting concerns live in ONE place):
 *   - Consent gating (any op that emits or stores PII to Mixpanel —
 *     see OP_TABLE comment for the full list; ops that REDUCE data or
 *     are operator-controlled lifecycle actions bypass the gate).
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

// Consent-gating rule: any op that EMITS or STORES PII to Mixpanel is
// gated. Ops that REDUCE data or that are operator-controlled lifecycle
// actions are NOT gated. Specifically:
//
//   Gated (cannot run when consent denied):
//     track, identify, alias            — emit identity / events
//     register, register_once           — persist super-props in the
//                                         Mixpanel cookie (PII at rest)
//     opt_in_tracking                   — flipping opt-in under denied
//                                         consent is incoherent
//     people.set / set_once / increment / append / union / track_charge
//                                       — write profile data
//
//   NOT gated:
//     unregister                        — removes a super-prop (reduces)
//     reset                             — operator/state reset
//     opt_out_tracking                  — operator MUST be able to opt
//                                         out regardless of consent state
//     people.unset                      — removes profile data (reduces)
const OP_TABLE: Record<MixpanelOp, OpHandler> = {
  track: {
    invoke: (mp, [event, props]) =>
      mp.track(event as string, (props as Record<string, unknown>) || {}),
    consentGated: true,
    enrichable: true,
  },
  identify: {
    invoke: (mp, [id]) => mp.identify(id as string),
    consentGated: true,
  },
  register: {
    invoke: (mp, [props]) => mp.register(props as Record<string, unknown>),
    consentGated: true,
  },
  register_once: {
    invoke: (mp, [props]) => mp.register_once(props as Record<string, unknown>),
    consentGated: true,
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
    consentGated: true,
    // Excluded from secondary by default — Simplified ID Merge projects
    // do not use the legacy alias-to-merge flow.
    defaultInstances: ['primary'],
  },
  reset: {
    invoke: (mp) => mp.reset(),
  },
  opt_in_tracking: {
    invoke: (mp) => mp.opt_in_tracking(),
    consentGated: true,
  },
  opt_out_tracking: {
    invoke: (mp) => mp.opt_out_tracking(),
  },
  'people.set': {
    invoke: (mp, [props]) => mp.people.set(props as Record<string, unknown>),
    consentGated: true,
  },
  'people.set_once': {
    invoke: (mp, [props]) => mp.people.set_once(props as Record<string, unknown>),
    consentGated: true,
  },
  'people.increment': {
    invoke: (mp, [props, by]) =>
      mp.people.increment(props as Record<string, unknown> | string, by as number | undefined),
    consentGated: true,
  },
  'people.append': {
    invoke: (mp, [props]) => mp.people.append(props as Record<string, unknown>),
    consentGated: true,
  },
  'people.union': {
    invoke: (mp, [props]) => mp.people.union(props as Record<string, unknown>),
    consentGated: true,
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
    consentGated: true,
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
 * **Impure** — gets the instance's live Mixpanel handle, ADOPTING the
 * global if state.mpRef isn't set yet. Writes to `state.mpRef` and
 * `state.initialized` as a side effect when adoption succeeds.
 *
 * Two code paths feed this:
 *   1. Normal init: onInstanceLoaded sets state.mpRef → this is a pure
 *      read (no adoption).
 *   2. Tests that install window.mixpanel directly without going
 *      through init() (legacy single-instance test pattern). This
 *      function adopts that global into state so subsequent dispatches
 *      stay consistent.
 *
 * The stub queue installed by loader.ts is tagged with `_ppStub: true`
 * and explicitly skipped — its `.track` is a queueing closure that
 * pushes into `_i[]` for replay, not a real send. Adopting the stub
 * would silently make the watchdog drain "succeed" into a queue that
 * only drains when the real SDK finally loads.
 */
function getOrAdoptMpRef(name: InstanceName): MixpanelGlobal | undefined {
  const state = getState(name);
  if (state.mpRef) return state.mpRef;
  const g = typeof globalThis !== 'undefined'
    ? (globalThis as { mixpanel?: MixpanelGlobal })
    : undefined;
  if (!g || !g.mixpanel) return undefined;
  // Skip the loader's stub queue — its `.track` is a closure that pushes
  // into `_i[]` for replay, not a real send. If we returned the stub
  // here, the watchdog drain would "succeed" into a queue that only
  // drains when the real SDK finally loads. See loader.ts `_ppStub`.
  if ((g.mixpanel as { _ppStub?: boolean })._ppStub) return undefined;
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
  return !!getOrAdoptMpRef(name);
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
  if (targets.length === 0) {
    // alias's defaultInstances is ['primary'] (Simplified ID Merge
    // projects don't use alias). After the cutover that flips
    // `primary.enabled: false`, alias becomes a silent no-op. Warn so
    // legacy code paths surface instead of failing invisibly.
    if (op === 'alias') pp.log('warn', M.ALIAS_NO_TARGET);
    return false;
  }

  // Buffering rule:
  //   - Normal dispatch: if ANY targeted instance isn't ready, buffer the
  //     whole call so we don't silently break parity by sending to one
  //     instance only. Re-enrichment happens on drain.
  //   - force=true (watchdog escape hatch): buffer ONLY if NO target is
  //     ready. Partial fan-out is allowed once we've given up on full
  //     parity for this boot cycle.
  const readyTargets = targets.filter((n) => isReady(n));
  if (readyTargets.length === 0) {
    return enqueue({ op, args, options: options ? { ...options } : undefined });
  }
  if (!(options && options.force) && readyTargets.length < targets.length) {
    return enqueue({ op, args, options: options ? { ...options } : undefined });
  }

  // Enrich once, fan out with per-instance try/catch.
  let resolvedArgs = args;
  if (handler.enrichable && !(options && options.skipEnrichment)) {
    resolvedArgs = enrichTrackArgs(args);
  }

  let anyOk = false;
  for (let i = 0; i < readyTargets.length; i++) {
    const name = readyTargets[i];
    const mp = getOrAdoptMpRef(name);
    /*! v8 ignore start */
    if (!mp) continue;
    /*! v8 ignore stop */
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

/**
 * Watchdog escape hatch — replay the buffered queue with `force: true` so
 * dispatch allows partial fan-out. Returns the number of entries that
 * reached at least one ready instance. Entries that found NO ready
 * instance are re-buffered by dispatch's own enqueue path; the caller
 * can read `queueSize()` to see how many remain stuck.
 *
 * Why a force flag (vs duplicating dispatch's invoke loop here): the
 * consent gate, OP_TABLE routing rules, alias-primary-only default,
 * empty-event-name guard, and enrichment all live inside dispatch. Going
 * around dispatch would duplicate every one of those concerns AND make
 * future routing-table edits a two-place change. The `force` flag is a
 * single bit on DispatchOptions that flips one branch — much narrower
 * surface to maintain.
 */
export function drainToReady(): number {
  if (!pp) return 0;
  const entries = drain();
  if (entries.length === 0) return 0;
  let dispatched = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Decide before dispatching whether this entry can hit any instance
    // — dispatch's return value can't tell us "dispatched vs re-enqueued"
    // since both paths return true. resolveTargets honors the same
    // routing rules (alias defaults, runtime setEnabled) that dispatch
    // would use, so the count stays accurate even for op-specific
    // routing.
    const targets = resolveTargets(entry.op, entry.options);
    const hasReady = targets.some((n) => isReady(n));
    const forcedOpts: DispatchOptions = { ...(entry.options || {}), force: true };
    dispatch(entry.op, entry.args, forcedOpts);
    if (hasReady) dispatched++;
  }
  return dispatched;
}
