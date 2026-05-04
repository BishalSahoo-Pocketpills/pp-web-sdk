/**
 * Cross-module session management.
 *
 * Provides a shared session ID (localStorage-based, 30-min inactivity timeout)
 * for event enrichment. Independent of Mixpanel's session tracking.
 */
export interface SessionService {
  getOrCreateSessionId: () => string;
  clearSession: () => void;
}

var SESSION_KEY = 'pp_analytics_session_id';
var ACTIVITY_KEY = 'pp_analytics_last_activity';
var TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) { /* fallback */ }

  // Manual v4 UUID for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function createSessionService(): SessionService {

  function getOrCreateSessionId(): string {
    try {
      var now = Date.now();
      var lastActivity = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
      var sessionId = localStorage.getItem(SESSION_KEY);

      // New session if expired or missing
      if (!sessionId || (now - lastActivity) > TIMEOUT_MS) {
        sessionId = generateId();
        localStorage.setItem(SESSION_KEY, sessionId);
      }

      localStorage.setItem(ACTIVITY_KEY, String(now));
      return sessionId;
    } catch (e) {
      // localStorage unavailable — return ephemeral ID
      return generateId();
    }
  }

  function clearSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(ACTIVITY_KEY);
    } catch (e) { /* silent */ }
  }

  return { getOrCreateSessionId: getOrCreateSessionId, clearSession: clearSession };
}
