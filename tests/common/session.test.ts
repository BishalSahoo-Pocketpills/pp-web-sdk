import { createSessionService } from '../../src/common/session';
import { createSetCookie, createGetCookie, createDeleteCookie } from '../../src/common/cookies';
import type { PPLib } from '../../src/types/common.types';

function makeCookiePPLib(): PPLib {
  const log = vi.fn();
  return {
    config: { cookieDomain: undefined } as never,
    log,
    getCookie: createGetCookie(document),
    setCookie: createSetCookie(document, window, log),
    deleteCookie: createDeleteCookie(document, window, log),
  } as unknown as PPLib;
}

function clearAllCookies(): void {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
  });
}

describe('createSessionService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a new session ID on first call', () => {
    const session = createSessionService();
    const id = session.getOrCreateSessionId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns the same session ID within the timeout window', () => {
    const session = createSessionService();
    const id1 = session.getOrCreateSessionId();
    const id2 = session.getOrCreateSessionId();
    expect(id2).toBe(id1);
  });

  it('generates a new session ID after 30-min inactivity', () => {
    vi.useFakeTimers();
    const session = createSessionService();
    const id1 = session.getOrCreateSessionId();

    vi.advanceTimersByTime(31 * 60 * 1000);
    const id2 = session.getOrCreateSessionId();
    expect(id2).not.toBe(id1);

    vi.useRealTimers();
  });

  it('persists session ID in localStorage', () => {
    const session = createSessionService();
    const id = session.getOrCreateSessionId();
    expect(localStorage.getItem('_pps')).toBe(id);
  });

  it('updates last activity timestamp on each call', () => {
    vi.useFakeTimers();
    const session = createSessionService();
    session.getOrCreateSessionId();
    const ts1 = localStorage.getItem('_ppsa');

    vi.advanceTimersByTime(5000);
    session.getOrCreateSessionId();
    const ts2 = localStorage.getItem('_ppsa');

    expect(Number(ts2)).toBeGreaterThan(Number(ts1));
    vi.useRealTimers();
  });

  it('clearSession removes localStorage entries', () => {
    const session = createSessionService();
    session.getOrCreateSessionId();
    expect(localStorage.getItem('_pps')).not.toBeNull();

    session.clearSession();
    expect(localStorage.getItem('_pps')).toBeNull();
    expect(localStorage.getItem('_ppsa')).toBeNull();
  });

  it('generates new ID after clearSession', () => {
    const session = createSessionService();
    const id1 = session.getOrCreateSessionId();
    session.clearSession();
    const id2 = session.getOrCreateSessionId();
    expect(id2).not.toBe(id1);
  });

  it('handles localStorage errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no storage'); });
    const session = createSessionService();
    const id = session.getOrCreateSessionId();
    expect(id).toBeTruthy(); // returns ephemeral ID
    vi.mocked(Storage.prototype.getItem).mockRestore();
  });

  it('clearSession handles localStorage errors silently', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('no storage'); });
    const session = createSessionService();
    expect(() => session.clearSession()).not.toThrow();
    vi.mocked(Storage.prototype.removeItem).mockRestore();
  });

  it('generates valid UUID format', () => {
    const session = createSessionService();
    const id = session.getOrCreateSessionId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uses fallback UUID when crypto.randomUUID unavailable', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });

    const session = createSessionService();
    const id = session.getOrCreateSessionId();
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);

    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
  });
});

// =============================================================================
// Cross-subdomain cookie-backed session service
// =============================================================================
describe('createSessionService (cookie-backed, win + ppLib)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllCookies();
  });

  it('dual-writes session_id to pp_analytics_session_id (primary) AND _pps (fallback)', () => {
    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBeTruthy();
    // Both cookies carry the same value — long-form is the read primary
    // (external consumers key off it); short-form is the redundant fallback
    // kept alive in case the long-form gets blocked or cleared.
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent(id));
    expect(document.cookie).toContain('_pps=' + encodeURIComponent(id));
    // localStorage stays empty under the cookie-backed contract.
    expect(localStorage.getItem('_pps')).toBeNull();
    expect(localStorage.getItem('_ppsa')).toBeNull();
  });

  it('dual-writes last_activity to pp_analytics_last_activity AND _ppsa, updating both on every call', () => {
    vi.useFakeTimers();
    const session = createSessionService(window, makeCookiePPLib());
    session.getOrCreateSessionId();
    // Both cookies present.
    expect(document.cookie).toMatch(/pp_analytics_last_activity=\d+/);
    expect(document.cookie).toMatch(/_ppsa=\d+/);

    const ts1Primary = Number(document.cookie.match(/pp_analytics_last_activity=(\d+)/)![1]);
    const ts1Fallback = Number(document.cookie.match(/_ppsa=(\d+)/)![1]);
    expect(ts1Primary).toBe(ts1Fallback);

    vi.advanceTimersByTime(5000);
    session.getOrCreateSessionId();
    const ts2Primary = Number(document.cookie.match(/pp_analytics_last_activity=(\d+)/)![1]);
    const ts2Fallback = Number(document.cookie.match(/_ppsa=(\d+)/)![1]);
    expect(ts2Primary).toBeGreaterThan(ts1Primary);
    expect(ts2Fallback).toBe(ts2Primary);

    vi.useRealTimers();
  });

  it('reuses the same session_id within the inactivity window', () => {
    const session = createSessionService(window, makeCookiePPLib());
    const id1 = session.getOrCreateSessionId();
    const id2 = session.getOrCreateSessionId();
    expect(id2).toBe(id1);
  });

  it('rotates session_id after 30 minutes of inactivity', () => {
    vi.useFakeTimers();
    const session = createSessionService(window, makeCookiePPLib());
    const id1 = session.getOrCreateSessionId();

    vi.advanceTimersByTime(31 * 60 * 1000);
    const id2 = session.getOrCreateSessionId();
    expect(id2).not.toBe(id1);

    vi.useRealTimers();
  });

  it('seeds from legacy localStorage when no cookies are present, dual-writing into both cookies', () => {
    // Pre-cookie-era user: only legacy localStorage entries exist.
    const legacyId = 'legacy-session-uuid';
    const legacyActivity = Date.now();
    localStorage.setItem('pp_analytics_session_id', legacyId);
    localStorage.setItem('pp_analytics_last_activity', String(legacyActivity));

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBe(legacyId);
    // Both cookies now seeded with the legacy value.
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent(legacyId));
    expect(document.cookie).toContain('_pps=' + encodeURIComponent(legacyId));
    expect(document.cookie).toMatch(/pp_analytics_last_activity=\d+/);
    expect(document.cookie).toMatch(/_ppsa=\d+/);
  });

  it('reads pp_analytics_session_id as primary, _pps as fallback when only fallback is present', () => {
    // Simulate a scenario where the long-form cookie was cleared but the
    // short-form one survives — the SDK should read it and re-establish
    // the dual-write on the next call.
    document.cookie = '_pps=' + encodeURIComponent('fallback-id') + ';path=/';
    document.cookie = '_ppsa=' + Date.now() + ';path=/';

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBe('fallback-id');
    // After read, dual-write re-establishes the long-form cookie too.
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent('fallback-id'));
    expect(document.cookie).toContain('_pps=' + encodeURIComponent('fallback-id'));
  });

  it('prefers pp_analytics_session_id (primary) over _pps (fallback) when both are present with different values', () => {
    document.cookie = 'pp_analytics_session_id=' + encodeURIComponent('primary-id') + ';path=/';
    document.cookie = 'pp_analytics_last_activity=' + Date.now() + ';path=/';
    document.cookie = '_pps=' + encodeURIComponent('fallback-id') + ';path=/';
    document.cookie = '_ppsa=' + Date.now() + ';path=/';

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    // Primary wins; the fallback gets overwritten to match on the next write.
    expect(id).toBe('primary-id');
    expect(document.cookie).toContain('_pps=' + encodeURIComponent('primary-id'));
  });

  it('clearSession deletes all four cookies AND legacy localStorage residue', () => {
    // Plant residue across every storage layer.
    localStorage.setItem('pp_analytics_session_id', 'ls-residue');
    localStorage.setItem('pp_analytics_last_activity', '1');
    const session = createSessionService(window, makeCookiePPLib());
    session.getOrCreateSessionId();
    expect(document.cookie).toContain('pp_analytics_session_id=');
    expect(document.cookie).toContain('_pps=');

    session.clearSession();
    expect(document.cookie).not.toMatch(/pp_analytics_session_id=[^;]/);
    expect(document.cookie).not.toMatch(/pp_analytics_last_activity=[^;]/);
    expect(document.cookie).not.toMatch(/_pps=[^;]/);
    expect(document.cookie).not.toMatch(/_ppsa=[^;]/);
    expect(localStorage.getItem('pp_analytics_session_id')).toBeNull();
    expect(localStorage.getItem('pp_analytics_last_activity')).toBeNull();
  });
});
