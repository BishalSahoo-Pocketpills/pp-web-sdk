beforeEach(() => {
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
