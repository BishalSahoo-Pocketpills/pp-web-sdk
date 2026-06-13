/**
 * Cross-module session management.
 *
 * Provides a shared session ID (cross-subdomain cookie, 30-min inactivity
 * timeout) for event enrichment. Independent of Mixpanel's session tracking.
 *
 * Storage strategy: the long-form names (`pp_analytics_session_id` /
 * `pp_analytics_last_activity`) are the SOLE write target — that's what
 * downstream consumers (GTM tags, BigQuery exports, the Angular webapp reading
 * on the same domain) key off. The short opaque `_pps` / `_ppsa` names are a
 * v3.3.0 dual-write bridge that has since been retired: they are still READ as
 * a one-time fallback (so a session persisted by an older build migrates
 * forward), then swept once per page. They are never written.
 *
 * Read order: `pp_analytics_session_id` → `_pps` → legacy localStorage
 * → generate fresh.
 *
 * Hot-path cost: getOrCreateSessionId() runs on every event build and inside
 * each Mixpanel instance's track wrapper (3-4x per tracked event). To avoid
 * re-scanning and re-writing cookies that many times, the resolved id is cached
 * in memory and the activity cookie is re-persisted at most once every
 * ACTIVITY_WRITE_THROTTLE_MS — far below the 30-min inactivity window, so a
 * slightly-stale persisted timestamp can never wrongly expire a live session.
 */
import type { PPLib } from '@src/types/common.types';
import { generateUuid } from '@src/common/uuid';

export interface SessionService {
  getOrCreateSessionId: () => string;
  clearSession: () => void;
}

// Read primary + write target (long-form names that external consumers
// key off — GTM tags, BigQuery exports, Angular webapp).
const SESSION_KEY = 'pp_analytics_session_id';
const ACTIVITY_KEY = 'pp_analytics_last_activity';
// Read fallback + redundant write target (obscure names from the v3.3.0
// rename — kept alive so the SDK can fall back to them if the long-form
// cookies get blocked or selectively cleared).
const SESSION_FALLBACK_KEY = '_pps';
const ACTIVITY_FALLBACK_KEY = '_ppsa';
// Legacy localStorage keys (pre-cookie era) — one-shot seed read only.
const LEGACY_LS_SESSION_KEY = 'pp_analytics_session_id';
const LEGACY_LS_ACTIVITY_KEY = 'pp_analytics_last_activity';
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const COOKIE_MAX_AGE_SECONDS = 30 * 60; // 30 minutes (sliding via every read)

// Fallback for legacy environments — when the common bootstrap doesn't pass
// ppLib (older test harnesses), we degrade to pure-localStorage behavior so
// the contract stays stable. Production always passes ppLib.
function legacyLocalStorageImpl(): SessionService {
  // Keep using the short names in this branch — the long-form dual-write
  // only applies to the cookie-backed implementation. Test harnesses that
  // hit this path were asserting against `_pps` / `_ppsa` historically.
  function getOrCreateSessionId(): string {
    try {
      const now = Date.now();
      const lastActivity = parseInt(localStorage.getItem('_ppsa') || '0', 10);
      let sessionId = localStorage.getItem('_pps');

      if (!sessionId || (now - lastActivity) > TIMEOUT_MS) {
        sessionId = generateUuid();
        localStorage.setItem('_pps', sessionId);
      }

      localStorage.setItem('_ppsa', String(now));
      return sessionId;
    } catch (e) {
      return generateUuid();
    }
  }

  function clearSession(): void {
    try {
      localStorage.removeItem('_pps');
      localStorage.removeItem('_ppsa');
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

  // Capture non-optional locals so TypeScript's narrowing carries into
  // the nested closures below.
  const w: Window & typeof globalThis = win;
  const pp: PPLib = ppLib;

  function writeCookie(name: string, value: string): void {
    try {
      // Read cookieDomain dynamically so post-boot updates to ppLib.config
      // take effect immediately — matches the pattern in persistent-storage.
      pp.setCookie!(name, value, {
        domain: pp.config.cookieDomain,
        path: '/',
        maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
        sameSite: 'Lax',
      });
    } catch (_e) {
      // best-effort persistence — surface via the existing log channel
      pp.log('error', 'session.writeCookie error', { cookieName: name });
    }
  }

  function writeSessionId(sessionId: string): void {
    writeCookie(SESSION_KEY, sessionId);
  }

  function writeActivity(now: number): void {
    writeCookie(ACTIVITY_KEY, String(now));
  }

  // One-time sweep of the retired v3.3.0 `_pps` / `_ppsa` fallback cookies.
  // Runs once per page AFTER the first read (so the fallback-read migration
  // path still works) instead of on every getOrCreateSessionId() write, where
  // it cost two extra document.cookie deletes per call, 3-4x per event.
  let fallbackSwept = false;
  function sweepFallbacksOnce(): void {
    if (fallbackSwept) return;
    fallbackSwept = true;
    try { pp.deleteCookie(SESSION_FALLBACK_KEY); } catch (_e) { /* best-effort */ }
    try { pp.deleteCookie(ACTIVITY_FALLBACK_KEY); } catch (_e) { /* best-effort */ }
  }

  /**
   * Read the session ID following the configured priority:
   *   1. `pp_analytics_session_id` (long-form primary)
   *   2. `_pps` (short-form fallback)
   *   3. legacy localStorage `pp_analytics_session_id` (one-shot seed)
   *
   * Returns null if every source is empty. Generation is coordinated by
   * `getOrCreateSessionId` so it can fold in the activity-timeout check.
   */
  function readSessionId(): string | null {
    const fromPrimary = pp.getCookie(SESSION_KEY);
    if (typeof fromPrimary === 'string' && fromPrimary.length > 0) return fromPrimary;

    const fromFallback = pp.getCookie(SESSION_FALLBACK_KEY);
    if (typeof fromFallback === 'string' && fromFallback.length > 0) return fromFallback;

    try {
      const fromLs = w.localStorage.getItem(LEGACY_LS_SESSION_KEY);
      if (typeof fromLs === 'string' && fromLs.length > 0) {
        // One-shot seed migration — copy into both cookies. Don't purge
        // the localStorage entry; subsequent reads will hit a cookie
        // first, so we don't churn the localStorage on every read.
        return fromLs;
      }
    } catch (_e) {
      // localStorage disabled
    }
    return null;
  }

  function readActivity(): number {
    const fromPrimary = pp.getCookie(ACTIVITY_KEY);
    if (typeof fromPrimary === 'string' && fromPrimary.length > 0) {
      const n = parseInt(fromPrimary, 10);
      if (isFinite(n) && n > 0) return n;
    }
    const fromFallback = pp.getCookie(ACTIVITY_FALLBACK_KEY);
    if (typeof fromFallback === 'string' && fromFallback.length > 0) {
      const n = parseInt(fromFallback, 10);
      if (isFinite(n) && n > 0) return n;
    }
    try {
      const fromLs = w.localStorage.getItem(LEGACY_LS_ACTIVITY_KEY);
      if (typeof fromLs === 'string' && fromLs.length > 0) {
        const n = parseInt(fromLs, 10);
        if (isFinite(n) && n > 0) return n;
      }
    } catch (_e) {
      // localStorage disabled
    }
    return 0;
  }

  // In-memory cache + activity-write throttle (see header). Reset on
  // clearSession so a cleared session regenerates rather than returning a
  // stale id.
  let cachedSessionId: string | null = null;
  let lastActivityWriteMs = 0;
  const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000; // re-persist activity at most every 30s

  function getOrCreateSessionId(): string {
    try {
      const now = Date.now();
      // Fast path: within the throttle window, trust the cache and touch no
      // cookies. The throttle (30s) is far below the inactivity window (30min),
      // so the persisted last-activity being up to 30s stale can never wrongly
      // expire an active session.
      if (cachedSessionId && (now - lastActivityWriteMs) < ACTIVITY_WRITE_THROTTLE_MS) {
        return cachedSessionId;
      }

      const lastActivity = readActivity();
      let sessionId = readSessionId();

      if (!sessionId || (now - lastActivity) > TIMEOUT_MS) {
        sessionId = generateUuid();
        writeSessionId(sessionId);
      } else if (sessionId !== cachedSessionId) {
        // Persist only when the id differs from the cache (first read this
        // page, or a fallback/legacy migration). Drops the per-event defensive
        // rewrite that previously fired on every single call.
        writeSessionId(sessionId);
      }

      cachedSessionId = sessionId;
      writeActivity(now);
      lastActivityWriteMs = now;
      sweepFallbacksOnce();
      return sessionId;
    } catch (e) {
      // Storage unavailable — return an ephemeral ID so the caller can
      // still tag in-memory events without crashing.
      return generateUuid();
    }
  }

  function deleteCookie(name: string): void {
    try {
      pp.setCookie!(name, '', {
        domain: pp.config.cookieDomain,
        path: '/',
        maxAgeSeconds: 0,
        sameSite: 'Lax',
      });
    } catch (_e) {
      // best-effort
    }
    try {
      if (pp.deleteCookie) pp.deleteCookie(name);
    } catch (_e) {
      // best-effort — covers the host-scoped legacy form
    }
  }

  function clearSession(): void {
    cachedSessionId = null;
    lastActivityWriteMs = 0;
    deleteCookie(SESSION_KEY);
    deleteCookie(SESSION_FALLBACK_KEY);
    deleteCookie(ACTIVITY_KEY);
    deleteCookie(ACTIVITY_FALLBACK_KEY);
    try {
      w.localStorage.removeItem(LEGACY_LS_SESSION_KEY);
      w.localStorage.removeItem(LEGACY_LS_ACTIVITY_KEY);
    } catch (_e) {
      // localStorage disabled
    }
  }

  return { getOrCreateSessionId: getOrCreateSessionId, clearSession: clearSession };
}
