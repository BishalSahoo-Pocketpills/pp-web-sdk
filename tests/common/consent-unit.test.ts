import { describe, it, expect, vi } from 'vitest';
import { createConsentService } from '@src/common/consent';
import type { PPLib } from '@src/types/common.types';

// Direct-import unit tests so coverage attributes to src/common/consent.ts
// (the IIFE-loaded consent.test.ts exercises the same code but, as a
// coverable:false `common` load, does not attribute). These cover every branch.

function makeMemoryStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  };
}

function makeCtx(opts: { ppAnalytics?: unknown; localStorage?: unknown } = {}) {
  const log = vi.fn();
  const safeLogError = vi.fn((e: unknown) => ({ message: String(e) }) as never);
  const win = {
    localStorage: opts.localStorage ?? makeMemoryStorage(),
    ppAnalytics: opts.ppAnalytics,
  } as unknown as Window & typeof globalThis;
  const ppLib = { log, safeLogError } as unknown as PPLib;
  return { svc: createConsentService(win, ppLib), log };
}

describe('createConsentService (unit)', () => {
  describe('status resolution order', () => {
    it('delegation (ppAnalytics) wins over everything', () => {
      const { svc } = makeCtx({ ppAnalytics: { consent: { status: () => false } } });
      svc.grant(); // explicit grant ignored — delegation says denied
      expect(svc.status()).toBe('denied');
      expect(svc.isGranted()).toBe(false);
    });

    it('delegation granted', () => {
      const { svc } = makeCtx({ ppAnalytics: { consent: { status: () => true } } });
      expect(svc.status()).toBe('granted');
    });

    it('delegation that throws falls through to the next source', () => {
      const { svc } = makeCtx({ ppAnalytics: { consent: { status: () => { throw new Error('x'); } } } });
      expect(svc.status()).toBe('granted'); // opt-out default
    });

    it('falls through when ppAnalytics has no status function', () => {
      const { svc } = makeCtx({ ppAnalytics: { consent: {} } });
      expect(svc.status()).toBe('granted');
    });

    it('a DISARMED delegate (isRequired:false) does not neuter an explicit revoke', () => {
      // Regression: analytics ships consent.required:false, whose status()
      // returns a permissive true. Before the isRequired skip this overrode
      // ppLib.consent.revoke(), leaving the gate open and even re-opting-in.
      const ls = makeMemoryStorage();
      const { svc } = makeCtx({
        localStorage: ls,
        ppAnalytics: { consent: { status: () => true, isRequired: () => false } },
      });
      svc.revoke();
      expect(svc.status()).toBe('denied');
      expect(svc.isGranted()).toBe(false);
    });

    it('a DISARMED delegate is skipped so stored denied wins', () => {
      const ls = makeMemoryStorage();
      ls.setItem('pp_consent', 'denied');
      const { svc } = makeCtx({
        localStorage: ls,
        ppAnalytics: { consent: { status: () => true, isRequired: () => false } },
      });
      expect(svc.status()).toBe('denied');
    });

    it('an ARMED delegate (isRequired:true) is still authoritative', () => {
      const denied = makeCtx({ ppAnalytics: { consent: { status: () => false, isRequired: () => true } } });
      expect(denied.svc.status()).toBe('denied');
      const granted = makeCtx({ ppAnalytics: { consent: { status: () => true, isRequired: () => true } } });
      expect(granted.svc.status()).toBe('granted');
    });

    it('stored value wins when no delegation', () => {
      const ls = makeMemoryStorage();
      ls.setItem('pp_consent', 'denied');
      expect(makeCtx({ localStorage: ls }).svc.status()).toBe('denied');
      const ls2 = makeMemoryStorage();
      ls2.setItem('pp_consent', 'approved'); // legacy alias
      expect(makeCtx({ localStorage: ls2 }).svc.status()).toBe('granted');
    });

    it('readStored swallows a throwing localStorage', () => {
      const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
      expect(makeCtx({ localStorage: throwing }).svc.status()).toBe('granted'); // falls to default
    });

    it('in-memory lastExplicit is used when nothing is stored', () => {
      const throwing = {
        getItem: () => null,
        setItem: () => { throw new Error('blocked'); },
      };
      const { svc } = makeCtx({ localStorage: throwing });
      svc.revoke();
      expect(svc.status()).toBe('denied'); // lastExplicit fallback
    });

    it('mode default: opt-in denies, opt-out grants', () => {
      const optIn = makeCtx();
      optIn.svc.configure({ mode: 'opt-in' });
      expect(optIn.svc.status()).toBe('denied');
      const optOut = makeCtx();
      optOut.svc.configure({ mode: 'opt-out' });
      expect(optOut.svc.status()).toBe('granted');
    });
  });

  describe('persist', () => {
    it('grant/revoke persist to localStorage', () => {
      const ls = makeMemoryStorage();
      const { svc } = makeCtx({ localStorage: ls });
      svc.grant();
      expect(ls.getItem('pp_consent')).toBe('granted');
      svc.revoke();
      expect(ls.getItem('pp_consent')).toBe('denied');
    });

    it('warns (no throw) when persistence is blocked', () => {
      const { svc, log } = makeCtx({
        localStorage: { getItem: () => null, setItem: () => { throw new Error('blocked'); } },
      });
      expect(() => svc.grant()).not.toThrow();
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('localStorage unavailable'));
    });
  });

  describe('configure', () => {
    it('updates mode and storageKey, ignores invalid values', () => {
      const ls = makeMemoryStorage();
      const { svc } = makeCtx({ localStorage: ls });
      svc.configure({ storageKey: 'custom_key' });
      svc.grant();
      expect(ls.getItem('custom_key')).toBe('granted');
      expect(ls.getItem('pp_consent')).toBeNull();
      // invalid/empty values are no-ops
      svc.configure({ mode: 'bogus' as never });
      svc.configure({ storageKey: '' });
      svc.configure({});
      expect(ls.getItem('custom_key')).toBe('granted'); // unchanged
    });
  });

  describe('subscribe / notify', () => {
    it('notifies the resolved status, deduped on no change', () => {
      const { svc } = makeCtx();
      const seen: string[] = [];
      svc.subscribe((s) => seen.push(s));
      svc.revoke();
      svc.revoke(); // dedup
      svc.grant();
      expect(seen).toEqual(['denied', 'granted']);
    });

    it('unsubscribe stops delivery and is idempotent', () => {
      const { svc } = makeCtx();
      const seen: string[] = [];
      const off = svc.subscribe((s) => seen.push(s));
      svc.revoke();
      off();
      off(); // idempotent — indexOf returns -1
      svc.grant();
      expect(seen).toEqual(['denied']);
    });

    it('isolates a throwing listener and logs it', () => {
      const { svc, log } = makeCtx();
      const seen: string[] = [];
      svc.subscribe(() => { throw new Error('boom'); });
      svc.subscribe((s) => seen.push(s));
      expect(() => svc.revoke()).not.toThrow();
      expect(seen).toEqual(['denied']);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('listener threw'), expect.anything());
    });

    it('snapshot: a mid-dispatch unsubscribe does not skip a sibling', () => {
      const { svc } = makeCtx();
      const order: string[] = [];
      let off3: () => void = () => {};
      svc.subscribe(() => order.push('l1'));
      svc.subscribe(() => { order.push('l2'); off3(); });
      off3 = svc.subscribe(() => order.push('l3'));
      svc.revoke();
      expect(order).toEqual(['l1', 'l2', 'l3']);
    });
  });
});
