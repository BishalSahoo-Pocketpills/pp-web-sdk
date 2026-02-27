// Track event listeners added to document so we can clean them up between tests.
// IIFE modules register click/DOMContentLoaded listeners on document, and jsdom
// does not reset them between tests — this prevents accumulation across loadWithCommon() calls.
let trackedListeners: Array<{ type: string; fn: EventListenerOrEventListenerObject; opts?: any }> = [];
let origAddEventListener: typeof document.addEventListener | null = null;

beforeEach(() => {
  // Remove accumulated event listeners from previous test's loadWithCommon() calls
  for (const l of trackedListeners) {
    document.removeEventListener(l.type, l.fn, l.opts);
  }
  trackedListeners = [];

  // Intercept addEventListener to track new listeners
  if (!origAddEventListener) {
    origAddEventListener = document.addEventListener.bind(document);
  }
  document.addEventListener = function(type: string, fn: EventListenerOrEventListenerObject, opts?: any) {
    trackedListeners.push({ type, fn, opts });
    return origAddEventListener!(type, fn, opts);
  } as typeof document.addEventListener;

  // Reset window globals that modules attach to
  delete window.ppLib;
  delete window.ppLibReady;
  delete window.ppAnalytics;
  delete window.ppAnalyticsDebug;
  delete window.logoutUser;
  delete window.dataLayer;
  delete window.mixpanel;
  delete window.OnetrustActiveGroups;

  // Clear all storage
  localStorage.clear();
  sessionStorage.clear();

  // Reset document.cookie
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) {
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    }
  });

  // Reset document body classes and innerHTML
  document.body.className = '';
  document.body.innerHTML = '';

  // Reset document.title
  document.title = '';
});
