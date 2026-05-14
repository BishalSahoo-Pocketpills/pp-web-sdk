/**
 * Cross-module session management.
 *
 * Provides a shared session ID (cross-subdomain cookie, 30-min inactivity
 * timeout) for event enrichment. Independent of Mixpanel's session tracking.
 *
 * Storage migrated from origin-scoped localStorage to Domain-scoped cookies
 * so a user navigating between try.pocketpills.com and www.pocketpills.com
 * keeps the same session_id / activity timestamp. A one-time migration copies
 * any legacy localStorage values into the cookie and purges them.
 */
import type { PPLib } from '@src/types/common.types';
import { createPersistentValue } from '@src/common/persistent-storage';

export interface SessionService {
  getOrCreateSessionId: () => string;
  clearSession: () => void;
}

const SESSION_KEY = 'pp_analytics_session_id';
const ACTIVITY_KEY = 'pp_analytics_last_activity';
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const COOKIE_MAX_AGE_SECONDS = 30 * 60; // 30 minutes (sliding via every read)

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) { /* fallback */ }

  // Manual v4 UUID for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Fallback for legacy environments — when the common bootstrap doesn't pass
// ppLib (older test harnesses), we degrade to pure-localStorage behavior so
// the contract stays stable. Production always passes ppLib.
function legacyLocalStorageImpl(): SessionService {
  function getOrCreateSessionId(): string {
    try {
      const now = Date.now();
      const lastActivity = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
      let sessionId = localStorage.getItem(SESSION_KEY);

      if (!sessionId || (now - lastActivity) > TIMEOUT_MS) {
        sessionId = generateId();
        localStorage.setItem(SESSION_KEY, sessionId);
      }

      localStorage.setItem(ACTIVITY_KEY, String(now));
      return sessionId;
    } catch (e) {
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

export function createSessionService(
  win?: Window & typeof globalThis,
  ppLib?: PPLib
): SessionService {
  // Legacy fallthrough — pre-rollout harnesses still call the no-arg form.
  if (!win || !ppLib) return legacyLocalStorageImpl();

  const sessionStore = createPersistentValue<string>(win, ppLib, {
    cookieName: SESSION_KEY,
    maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
    serialize: (s) => s,
    deserialize: (s) => (typeof s === 'string' && s.length > 0) ? s : null,
    // No generate fn — we coordinate generation with the activity check below.
    legacyLocalStorageKey: SESSION_KEY
  });

  const activityStore = createPersistentValue<number>(win, ppLib, {
    cookieName: ACTIVITY_KEY,
    maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
    serialize: (n) => String(n),
    deserialize: (raw) => {
      const n = parseInt(raw, 10);
      return isFinite(n) && n > 0 ? n : null;
    },
    legacyLocalStorageKey: ACTIVITY_KEY
  });

  function getOrCreateSessionId(): string {
    try {
      const now = Date.now();
      const lastActivity = activityStore.read() || 0;
      let sessionId = sessionStore.read();

      // New session if expired or missing. Clearing activity first prevents
      // a stale TIMEOUT comparison from immediately re-expiring the new ID.
      if (!sessionId || (now - lastActivity) > TIMEOUT_MS) {
        sessionId = generateId();
        sessionStore.write(sessionId);
      }

      activityStore.write(now);
      return sessionId;
    } catch (e) {
      // Storage unavailable — return an ephemeral ID so the caller can
      // still tag in-memory events without crashing.
      return generateId();
    }
  }

  function clearSession(): void {
    try { sessionStore.clear(); } catch (e) { /* silent */ }
    try { activityStore.clear(); } catch (e) { /* silent */ }
  }

  return { getOrCreateSessionId: getOrCreateSessionId, clearSession: clearSession };
}
