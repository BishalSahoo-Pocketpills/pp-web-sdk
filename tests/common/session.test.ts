import { createSessionService } from '../../src/common/session';

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
    expect(localStorage.getItem('pp_analytics_session_id')).toBe(id);
  });

  it('updates last activity timestamp on each call', () => {
    vi.useFakeTimers();
    const session = createSessionService();
    session.getOrCreateSessionId();
    const ts1 = localStorage.getItem('pp_analytics_last_activity');

    vi.advanceTimersByTime(5000);
    session.getOrCreateSessionId();
    const ts2 = localStorage.getItem('pp_analytics_last_activity');

    expect(Number(ts2)).toBeGreaterThan(Number(ts1));
    vi.useRealTimers();
  });

  it('clearSession removes localStorage entries', () => {
    const session = createSessionService();
    session.getOrCreateSessionId();
    expect(localStorage.getItem('pp_analytics_session_id')).not.toBeNull();

    session.clearSession();
    expect(localStorage.getItem('pp_analytics_session_id')).toBeNull();
    expect(localStorage.getItem('pp_analytics_last_activity')).toBeNull();
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
