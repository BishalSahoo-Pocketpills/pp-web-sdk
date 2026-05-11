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
