import type { PPLib } from '../types/common.types';
import type { LoginConfig } from '../types/login.types';

export function createLogoutUser(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: LoginConfig
): (hardLogout?: boolean) => void {
  /**
   * Logout user — clears session cookies and UI state.
   *
   * Note: This does NOT clear third-party SDK state (Braze, Mixpanel, VWO).
   * Callers should also invoke vendor-specific logout methods if needed
   * (e.g. braze.wipeData(), mixpanel.reset()).
   */
  return function logoutUser(hardLogout?: boolean): void {
    try {
      hardLogout = hardLogout === true;

      // Remove session cookies
      ppLib.deleteCookie(CONFIG.cookieNames.userId);
      ppLib.deleteCookie(CONFIG.cookieNames.patientId);
      ppLib.deleteCookie(CONFIG.cookieNames.auth);
      ppLib.deleteCookie(CONFIG.cookieNames.appAuth);

      // Hard logout: also remove previous user data
      if (hardLogout) {
        ppLib.deleteCookie(CONFIG.cookieNames.prevUser);
        ppLib.deleteCookie(CONFIG.cookieNames.firstName);
      }

      // Update UI state immediately
      doc.body.classList.remove(CONFIG.bodyClasses.loggedIn, CONFIG.bodyClasses.signupCompleted);
      doc.body.classList.add(CONFIG.bodyClasses.loggedOut);

      // Reload page to reset state cleanly
      if (CONFIG.reloadOnLogout) {
        win.location.reload();
      }
    } catch (e) {
      ppLib.log('error', '[ppLogin] Logout error', e);
    }
  };
}
