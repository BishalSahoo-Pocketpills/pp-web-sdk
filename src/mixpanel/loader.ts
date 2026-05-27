/**
 * Mixpanel SDK loader — injects the vendored loader stub exactly once and
 * installs `window.mixpanel` as a stub queue. Calling `mp.init(token, opts,
 * name)` against the stub queues each instance into `_i[]`; the real SDK
 * (fetched async via the injected <script>) replays those entries on load.
 *
 * SRI / nonce / crossOrigin apply to the one injected script — there is no
 * per-instance variation. Per-instance config is locked down to token,
 * apiHost, enabled, initOptions, projectName (see SharedMixpanelConfig vs
 * MixpanelInstanceConfig in src/types/mixpanel.types.ts).
 *
 * Mixpanel JS SDK loader stub v1.2 (synced from cdn.mxpnl.com/libs/mixpanel-2-latest.min.js)
 * Last verified: 2026-05-07
 *
 * Restructured from the upstream `var`-based snippet to use `let`/`const`.
 * The two block-scope hazards in the original — (1) `d` declared inside a
 * `try` block but reassigned/used after it, and (2) `b`/`d`/`call2_args`/
 * `call2` declared in a `for`-init but closed over by a sibling inner
 * function `a()` — are resolved by hoisting those declarations to the
 * enclosing scope. Behavior is identical: same stub queue, same method
 * shadowing, same async script injection.
 */
import type { PPLib } from '@src/types/common.types';
import type { SharedMixpanelConfig } from '@src/types/mixpanel.types';
import { DEFAULTS, M } from '@src/mixpanel/messages';
import { checkSriIntegrity } from '@src/common/sri';

let pp: PPLib | null = null;
let shared: SharedMixpanelConfig | null = null;

export function configureLoader(ppLib: PPLib, sharedConfig: SharedMixpanelConfig): void {
  pp = ppLib;
  shared = sharedConfig;
}

export function resetLoader(): void {
  pp = null;
  shared = null;
}

/**
 * Idempotent. The vendored stub guards re-entry via `__SV`. Returns true
 * when the stub is (or now is) installed and ready to accept `mp.init`
 * calls; false when an SRI gate failure refused to install.
 */
export function loadMixpanelSDK(win: Window & typeof globalThis, doc: Document): boolean {
  if (!pp || !shared) return false;

  /*! v8 ignore start */
  if ((win as unknown as { mixpanel?: { __SV?: number } }).mixpanel
      && (win as unknown as { mixpanel?: { __SV?: number } }).mixpanel!.__SV) {
    return true;
  }
  /*! v8 ignore stop */

  const c: Document = doc;
  /*! v8 ignore start */
  const a: { [k: string]: unknown } & { __SV?: number; _i?: unknown[]; init?: unknown } =
    ((win as unknown as { mixpanel?: unknown }).mixpanel as { [k: string]: unknown } | undefined) || ([] as unknown as { [k: string]: unknown });

  if (!a.__SV) {
  /*! v8 ignore stop */
    // SRI gate runs BEFORE stub installation so a fail-closed refusal
    // doesn't leave window.mixpanel as a stub queue that callers silently
    // fill forever (mirrors the Braze loader; see sdk-loader.ts).
    const sriResult = checkSriIntegrity(shared.integrity, shared.requireIntegrity);
    if (sriResult === 'invalid-format') { pp.log('error', M.SRI_INVALID_FORMAT); return false; }
    if (sriResult === 'missing-required') { pp.log('error', M.SRI_REQUIRED_BUT_MISSING); return false; }
    if (sriResult === 'missing-optional') { pp.log('warn', M.SRI_MISSING_WARN); }

    let b: unknown = win;
    // `d` starts as the hash-state extractor (assigned in the try below),
    // then is reassigned to the first <script> element after the try.
    // Hoisted out of the try block so it survives the scope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let m: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let j: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const k: any = (b as { location: unknown }).location;
      const f = k.hash;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d = function (a: any, b: any) {
        return (m = a.match(RegExp(b + '=([^&]*)'))) ? m[1] : null;
      };
      f && d(f, 'state') &&
        ((j = JSON.parse(decodeURIComponent(d(f, 'state')))),
        'mpeditor' === j.action &&
          ((b as { sessionStorage: Storage }).sessionStorage.setItem('_mpcehash', f),
          history.replaceState(j.desiredHash || '', c.title, k.pathname + k.search)));
    } catch (_n) {
      /* hash extraction failed — non-fatal, continue installing stub */
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let l: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let h: any;
    (win as unknown as { mixpanel: unknown }).mixpanel = a;
    a._i = [];
    // Tag the stub so resolveMpRef can distinguish it from a real (or
    // test-installed) Mixpanel handle. Stub methods are queueing closures
    // that push into `_i` for replay; calling them does NOT actually
    // emit events. If resolveMpRef treated the stub as "ready" the
    // watchdog would log "force-drained" events that in fact just went
    // into the stub queue forever (if the real SDK never loads).
    (a as { _ppStub?: boolean })._ppStub = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.init = function (b: any, d: any, g: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function c(b: any, i: any) {
        const a = i.split('.');
        2 == a.length && ((b = b[a[0]]), (i = a[1]));
        b[i] = function () {
          b.push([i].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let e: any = a;
      'undefined' !== typeof g ? (e = (a as Record<string, unknown>)[g] = []) : (g = 'mixpanel');
      e.people = e.people || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e.toString = function (b: any) {
        let a = 'mixpanel';
        'mixpanel' !== g && (a += '.' + g);
        b || (a += ' (stub)');
        return a;
      };
      e.people.toString = function () {
        return e.toString(1) + '.people (stub)';
      };
      l =
        'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(
          ' ',
        );
      for (h = 0; h < l.length; h++) c(e, l[h]);
      const f = 'set set_once union unset remove delete'.split(' ');
      e.get_group = function () {
        const groupArgs = ['get_group'].concat(Array.prototype.slice.call(arguments, 0));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const groupShadow: any = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let call2_args: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let call2: any;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function a(c: any) {
          groupShadow[c] = function () {
            call2_args = arguments;
            call2 = [c].concat(Array.prototype.slice.call(call2_args, 0));
            e.push([groupArgs, call2]);
          };
        }
        for (let c = 0; c < f.length; c++) a(f[c]);
        return groupShadow;
      };
      (a._i as unknown[]).push([b, d, g]);
    };
    a.__SV = 1.2;
    b = c.createElement('script');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const script = b as any;
    script.type = 'text/javascript';
    script.async = !0;
    script.src = shared.cdnUrl || DEFAULTS.CDN_URL;
    /*! v8 ignore start — vendored Mixpanel SDK snippet, IIFE source map can't attribute nonce branch */
    if (shared.nonce) script.setAttribute('nonce', shared.nonce);
    /*! v8 ignore stop */
    if (shared.integrity) {
      script.integrity = shared.integrity;
      // crossOrigin is required for SRI enforcement on cross-origin scripts.
      script.crossOrigin = shared.crossOrigin || 'anonymous';
    }
    // Surface SRI mismatches and network failures — without an onerror
    // handler a stale integrity hash silently breaks Mixpanel for every
    // page load.
    script.onerror = function () {
      if (pp) pp.log('error', M.SDK_LOAD_FAILED(script.src));
    };
    d = c.getElementsByTagName('script')[0];
    d.parentNode.insertBefore(b, d);
  }
  return true;
}
