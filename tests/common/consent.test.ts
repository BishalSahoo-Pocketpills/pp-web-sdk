import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModule } from '@tests/helpers/iife-loader';

describe('ppLib.consent', () => {
  beforeEach(() => {
    try { window.localStorage.removeItem('pp_consent'); } catch (e) { /* ignore */ }
    try { window.localStorage.removeItem('custom_consent_key'); } catch (e) { /* ignore */ }
    delete (window as unknown as { ppAnalytics?: unknown }).ppAnalytics;
  });

  afterEach(() => {
    try { window.localStorage.clear(); } catch (e) { /* ignore */ }
  });

  describe('default opt-out mode', () => {
    it('grants by default when no signal is present', () => {
      loadModule('common');
      expect(window.ppLib.consent.isGranted()).toBe(true);
      expect(window.ppLib.consent.status()).toBe('granted');
    });

    it('denies when localStorage pp_consent is "denied"', () => {
      window.localStorage.setItem('pp_consent', 'denied');
      loadModule('common');
      expect(window.ppLib.consent.isGranted()).toBe(false);
      expect(window.ppLib.consent.status()).toBe('denied');
    });

    it('grants when localStorage pp_consent is "granted"', () => {
      window.localStorage.setItem('pp_consent', 'granted');
      loadModule('common');
      expect(window.ppLib.consent.status()).toBe('granted');
    });

    it('treats legacy "approved" value as granted', () => {
      window.localStorage.setItem('pp_consent', 'approved');
      loadModule('common');
      expect(window.ppLib.consent.status()).toBe('granted');
    });
  });

  describe('opt-in mode (GDPR)', () => {
    it('denies by default until explicit grant', () => {
      loadModule('common');
      window.ppLib.consent.configure({ mode: 'opt-in' });
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });

    it('respects explicit grant in opt-in mode', () => {
      loadModule('common');
      window.ppLib.consent.configure({ mode: 'opt-in' });
      window.ppLib.consent.grant();
      expect(window.ppLib.consent.isGranted()).toBe(true);
    });

    it('opt-in mode + pre-stored "granted" → granted (stored value beats mode default)', () => {
      window.localStorage.setItem('pp_consent', 'granted');
      loadModule('common');
      window.ppLib.consent.configure({ mode: 'opt-in' });
      // Opt-in defaults to denial, but a persisted grant from a prior
      // session must be honored without re-prompting.
      expect(window.ppLib.consent.isGranted()).toBe(true);
      expect(window.ppLib.consent.status()).toBe('granted');
    });

    it('opt-in mode + pre-stored "denied" → denied', () => {
      window.localStorage.setItem('pp_consent', 'denied');
      loadModule('common');
      window.ppLib.consent.configure({ mode: 'opt-in' });
      expect(window.ppLib.consent.isGranted()).toBe(false);
      expect(window.ppLib.consent.status()).toBe('denied');
    });

    it('opt-out mode + pre-stored "denied" → denied (stored value beats mode default)', () => {
      window.localStorage.setItem('pp_consent', 'denied');
      loadModule('common');
      // opt-out default would normally grant; explicit user denial wins.
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });
  });

  describe('delegation to ppAnalytics.consent', () => {
    it('delegates to ppAnalytics.consent.status when available', () => {
      (window as unknown as { ppAnalytics: unknown }).ppAnalytics = {
        consent: { status: () => false }
      };
      loadModule('common');
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });

    it('ppAnalytics delegation overrides localStorage', () => {
      window.localStorage.setItem('pp_consent', 'granted');
      (window as unknown as { ppAnalytics: unknown }).ppAnalytics = {
        consent: { status: () => false }
      };
      loadModule('common');
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });

    it('falls back to localStorage when ppAnalytics.consent.status throws', () => {
      (window as unknown as { ppAnalytics: unknown }).ppAnalytics = {
        consent: { status: () => { throw new Error('boom'); } }
      };
      window.localStorage.setItem('pp_consent', 'denied');
      loadModule('common');
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });
  });

  describe('grant / revoke persistence', () => {
    it('grant() persists to localStorage', () => {
      loadModule('common');
      window.ppLib.consent.grant();
      expect(window.localStorage.getItem('pp_consent')).toBe('granted');
    });

    it('revoke() persists to localStorage', () => {
      loadModule('common');
      window.ppLib.consent.revoke();
      expect(window.localStorage.getItem('pp_consent')).toBe('denied');
    });

    it('honors a custom storageKey', () => {
      loadModule('common');
      window.ppLib.consent.configure({ storageKey: 'custom_consent_key' });
      window.ppLib.consent.grant();
      expect(window.localStorage.getItem('custom_consent_key')).toBe('granted');
      expect(window.localStorage.getItem('pp_consent')).toBeNull();
    });
  });

  describe('subscribe / notify (post-boot consent changes)', () => {
    it('notifies subscribers with the new status on grant and revoke', () => {
      loadModule('common');
      const seen: string[] = [];
      window.ppLib.consent.subscribe((s) => seen.push(s));
      window.ppLib.consent.revoke();
      window.ppLib.consent.grant();
      expect(seen).toEqual(['denied', 'granted']);
    });

    it('stops delivering after unsubscribe', () => {
      loadModule('common');
      const seen: string[] = [];
      const off = window.ppLib.consent.subscribe((s) => seen.push(s));
      window.ppLib.consent.revoke();
      off();
      window.ppLib.consent.grant();
      expect(seen).toEqual(['denied']); // grant not delivered
    });

    it('unsubscribe is idempotent (calling it twice is a no-op)', () => {
      loadModule('common');
      const off = window.ppLib.consent.subscribe(() => {});
      off();
      expect(() => off()).not.toThrow();
    });

    it('isolates a throwing listener — others still run and persistence holds', () => {
      loadModule('common');
      const seen: string[] = [];
      window.ppLib.consent.subscribe(() => { throw new Error('listener boom'); });
      window.ppLib.consent.subscribe((s) => seen.push(s));
      expect(() => window.ppLib.consent.revoke()).not.toThrow();
      expect(seen).toEqual(['denied']); // second listener still notified
      expect(window.localStorage.getItem('pp_consent')).toBe('denied'); // persisted
    });

    it('notifies the RESOLVED status, not the raw call (delegation overrides grant)', () => {
      // ppAnalytics delegation is the source of truth and says DENIED.
      (window as unknown as { ppAnalytics: unknown }).ppAnalytics = {
        consent: { status: () => false }
      };
      loadModule('common');
      const seen: string[] = [];
      window.ppLib.consent.subscribe((s) => seen.push(s));
      window.ppLib.consent.grant(); // explicit grant, but delegation wins → denied
      expect(seen).toEqual(['denied']); // listener sees the effective status
      expect(window.ppLib.consent.isGranted()).toBe(false);
    });

    it('honors an explicit choice in-memory when persist fails (blocked storage)', () => {
      loadModule('common');
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const seen: string[] = [];
      window.ppLib.consent.subscribe((s) => seen.push(s));
      window.ppLib.consent.revoke(); // persist throws, but choice must hold
      expect(seen).toEqual(['denied']); // notified denied despite persist failure
      expect(window.ppLib.consent.isGranted()).toBe(false); // in-memory override
      spy.mockRestore();
    });

    it('dedupes redundant notifications when the status does not change', () => {
      loadModule('common');
      const seen: string[] = [];
      window.ppLib.consent.subscribe((s) => seen.push(s));
      window.ppLib.consent.revoke();
      window.ppLib.consent.revoke(); // same status → no second notify
      expect(seen).toEqual(['denied']);
    });

    it('does not skip a sibling when a listener unsubscribes another mid-dispatch', () => {
      loadModule('common');
      const order: string[] = [];
      let off3: () => void = () => {};
      window.ppLib.consent.subscribe(() => order.push('l1'));
      window.ppLib.consent.subscribe(() => { order.push('l2'); off3(); });
      off3 = window.ppLib.consent.subscribe(() => order.push('l3'));
      window.ppLib.consent.revoke();
      expect(order).toEqual(['l1', 'l2', 'l3']); // snapshot → l3 still fires this round
    });

    it('does not invoke a listener that subscribes during dispatch (this round)', () => {
      loadModule('common');
      const seen: string[] = [];
      window.ppLib.consent.subscribe(() => {
        window.ppLib.consent.subscribe(() => seen.push('added-mid-dispatch'));
      });
      window.ppLib.consent.revoke();
      expect(seen).toEqual([]); // newly-added listener not called this round
    });
  });

  describe('graceful degradation', () => {
    it('does not throw when localStorage is unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() { throw new Error('blocked'); },
        configurable: true
      });
      try {
        loadModule('common');
        expect(() => window.ppLib.consent.isGranted()).not.toThrow();
        expect(() => window.ppLib.consent.grant()).not.toThrow();
      } finally {
        if (original) Object.defineProperty(window, 'localStorage', original);
      }
    });
  });
});
