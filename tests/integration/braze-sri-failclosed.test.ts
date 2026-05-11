/**
 * Integration: common + braze with SRI fail-closed
 *
 * Locks in the SEC#1 fix from Track 2 + the consent gating from Track 6.
 * If requireIntegrity=true and no hash is configured, the Braze loader
 * must NOT install window.braze (mirrors the Mixpanel fail-closed fix).
 * If consent is revoked, queued events must drop silently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadModule } from '@tests/helpers/iife-loader';

describe('Integration: Braze fail-closed + consent', () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch (e) { /* ignore */ }
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete (window as unknown as { ppLib?: unknown }).ppLib;
    delete (window as unknown as { braze?: unknown }).braze;
    delete (window as unknown as { ppLibReady?: unknown }).ppLibReady;
  });

  it('does NOT install window.braze stub when requireIntegrity=true with no hash', () => {
    loadModule('common');
    loadModule('braze');

    const beforeCount = document.querySelectorAll('script[src*="appboycdn"]').length;
    window.ppLib.braze!.configure({
      sdk: {
        apiKey: 'k',
        baseUrl: 'sdk.braze.com',
        requireIntegrity: true
      }
    });
    window.ppLib.braze!.init();

    const afterCount = document.querySelectorAll('script[src*="appboycdn"]').length;
    expect(afterCount).toBe(beforeCount);
    // Stub must be absent — would silently queue events otherwise.
    expect(window.braze).toBeUndefined();
  });

  it('trackEvent silently no-ops when consent is revoked', () => {
    loadModule('common');
    loadModule('braze');

    // Install a real-looking braze object so we can see whether trackEvent
    // reaches it.
    const logCustomEvent = vi.fn();
    (window as unknown as { braze: { logCustomEvent: typeof logCustomEvent } }).braze = { logCustomEvent };

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'k', baseUrl: 'sdk.braze.com' }
    });
    window.ppLib.consent.revoke();

    window.ppLib.braze!.trackEvent('test_event', { foo: 'bar' });
    expect(logCustomEvent).not.toHaveBeenCalled();
  });

  it('trackEvent passes through when consent is granted', () => {
    loadModule('common');
    loadModule('braze');

    const logCustomEvent = vi.fn();
    (window as unknown as { braze: { logCustomEvent: typeof logCustomEvent } }).braze = { logCustomEvent };

    window.ppLib.braze!.configure({
      sdk: { apiKey: 'k', baseUrl: 'sdk.braze.com' }
    });
    window.ppLib.consent.grant();

    window.ppLib.braze!.trackEvent('test_event', { foo: 'bar' });
    expect(logCustomEvent).toHaveBeenCalledWith('test_event', expect.objectContaining({ foo: 'bar' }));
  });
});
