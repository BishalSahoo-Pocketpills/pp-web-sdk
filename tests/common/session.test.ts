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

  it('writes session_id to pp_analytics_session_id only and cleans up _pps fallback', () => {
    // Seed a leftover fallback cookie from the dual-write era.
    document.cookie = '_pps=old-fallback;path=/';
    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBeTruthy();
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent(id));
    // Fallback cookie should be deleted (Max-Age=0), not rewritten.
    expect(document.cookie).not.toContain('_pps=');
    expect(localStorage.getItem('_pps')).toBeNull();
    expect(localStorage.getItem('_ppsa')).toBeNull();
  });

  it('writes last_activity to pp_analytics_last_activity only and cleans up _ppsa fallback', () => {
    vi.useFakeTimers();
    document.cookie = '_ppsa=9999;path=/';
    const session = createSessionService(window, makeCookiePPLib());
    session.getOrCreateSessionId();

    expect(document.cookie).toMatch(/pp_analytics_last_activity=\d+/);
    // Fallback cookie should be deleted.
    expect(document.cookie).not.toContain('_ppsa=');

    vi.advanceTimersByTime(5000);
    session.getOrCreateSessionId();
    const ts2 = Number(document.cookie.match(/pp_analytics_last_activity=(\d+)/)![1]);
    expect(ts2).toBeGreaterThan(0);

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

  it('seeds from legacy localStorage when no cookies are present, writes to primary only', () => {
    const legacyId = 'legacy-session-uuid';
    const legacyActivity = Date.now();
    localStorage.setItem('pp_analytics_session_id', legacyId);
    localStorage.setItem('pp_analytics_last_activity', String(legacyActivity));

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBe(legacyId);
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent(legacyId));
    expect(document.cookie).toMatch(/pp_analytics_last_activity=\d+/);
    // No fallback cookies written.
    expect(document.cookie).not.toContain('_pps=');
    expect(document.cookie).not.toContain('_ppsa=');
  });

  it('reads _pps as fallback when only fallback is present, migrates to primary, cleans fallback', () => {
    document.cookie = '_pps=' + encodeURIComponent('fallback-id') + ';path=/';
    document.cookie = '_ppsa=' + Date.now() + ';path=/';

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBe('fallback-id');
    // Migrated to primary.
    expect(document.cookie).toContain('pp_analytics_session_id=' + encodeURIComponent('fallback-id'));
    // Fallback cleaned up.
    expect(document.cookie).not.toContain('_pps=');
  });

  it('prefers pp_analytics_session_id (primary) over _pps (fallback) and cleans fallback', () => {
    document.cookie = 'pp_analytics_session_id=' + encodeURIComponent('primary-id') + ';path=/';
    document.cookie = 'pp_analytics_last_activity=' + Date.now() + ';path=/';
    document.cookie = '_pps=' + encodeURIComponent('fallback-id') + ';path=/';
    document.cookie = '_ppsa=' + Date.now() + ';path=/';

    const session = createSessionService(window, makeCookiePPLib());
    const id = session.getOrCreateSessionId();

    expect(id).toBe('primary-id');
    // Fallback cleaned up, not rewritten.
    expect(document.cookie).not.toContain('_pps=');
  });

  it('clearSession deletes primary cookies, fallback cookies, AND legacy localStorage residue', () => {
    // Plant residue across every storage layer (including pre-existing fallbacks).
    localStorage.setItem('pp_analytics_session_id', 'ls-residue');
    localStorage.setItem('pp_analytics_last_activity', '1');
    document.cookie = '_pps=stale-fallback;path=/';
    document.cookie = '_ppsa=9999;path=/';
    const session = createSessionService(window, makeCookiePPLib());
    session.getOrCreateSessionId();
    expect(document.cookie).toContain('pp_analytics_session_id=');

    session.clearSession();
    expect(document.cookie).not.toMatch(/pp_analytics_session_id=[^;]/);
    expect(document.cookie).not.toMatch(/pp_analytics_last_activity=[^;]/);
    expect(document.cookie).not.toMatch(/_pps=[^;]/);
    expect(document.cookie).not.toMatch(/_ppsa=[^;]/);
    expect(localStorage.getItem('pp_analytics_session_id')).toBeNull();
    expect(localStorage.getItem('pp_analytics_last_activity')).toBeNull();
  });
});
