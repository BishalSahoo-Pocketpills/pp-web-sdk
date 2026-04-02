import type { PPLib } from '@src/types/common.types';
import type { LoginConfig } from '@src/types/login.types';

export function createInitAuthState(
  doc: Document,
  ppLib: PPLib,
  CONFIG: LoginConfig
): () => void {
  return function initAuthState(): void {
    try {
      const userId = ppLib.getCookie(CONFIG.cookieNames.userId);
      const authToken = ppLib.getCookie(CONFIG.cookieNames.auth);
      const appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth);
      const prevUserCookie = ppLib.getCookie(CONFIG.cookieNames.prevUser);
      const firstNameCookie = ppLib.getCookie(CONFIG.cookieNames.firstName);

      // A. Check Logged In Status
      const isUserIdValid = userId && userId !== '-1';
      const isAuthTokenValid = authToken && authToken !== '';

      if (isUserIdValid && isAuthTokenValid) {
        doc.body.classList.remove(CONFIG.bodyClasses.loggedOut);
        doc.body.classList.add(CONFIG.bodyClasses.loggedIn);
      } else {
        doc.body.classList.remove(CONFIG.bodyClasses.loggedIn);
        doc.body.classList.add(CONFIG.bodyClasses.loggedOut);
      }

      // B. Check Signup Completion
      if (appAuth === 'true') {
        doc.body.classList.add(CONFIG.bodyClasses.signupCompleted);
      }

      // C. Check Previous User (Welcome Back)
      let hasPreviousUser = false;
      let previousUserName = '';

      // Try parsing JSON cookie
      if (prevUserCookie) {
        try {
          const userData = JSON.parse(prevUserCookie);
          if (userData && (userData.firstName || userData.phone)) {
            hasPreviousUser = true;
            if (userData.firstName) previousUserName = userData.firstName;
          }
        } catch (e) {
          ppLib.log('error', '[ppLogin] Previous user JSON parse error', e);
        }
      }

      // Fallback to simple string cookie
      if (firstNameCookie) {
        hasPreviousUser = true;
        previousUserName = firstNameCookie;
      }

      if (hasPreviousUser) {
        doc.body.classList.add(CONFIG.bodyClasses.hasPreviousUser);

        // Inject name into elements with data-login-identifier-key="user-first-name"
        const nameElements = doc.querySelectorAll('[' + CONFIG.identifierAttribute + '="user-first-name"]');
        nameElements.forEach(function(el: any) {
          el.textContent = ppLib.Security.sanitize(previousUserName);
        });
      }

      // Mark DOM as ready (for opacity transition if used)
      doc.body.classList.add(CONFIG.bodyClasses.domReady);

      ppLib.log('info', '[ppLogin] Auth state initialized', {
        loggedIn: isUserIdValid && isAuthTokenValid,
        signupCompleted: appAuth === 'true',
        hasPreviousUser: hasPreviousUser
      });

    } catch (e) {
      ppLib.log('error', '[ppLogin] initAuthState error', e);
    }
  };
}
