import type { LoginConfig } from '@src/types/login.types';

export function createLoginConfig(): LoginConfig {
  return {
    cookieNames: {
      userId: 'userId',
      patientId: 'patientId',
      auth: 'Authorization',
      appAuth: 'app_is_authenticated',
      prevUser: 'previousUser',
      firstName: 'firstName'
    },
    bodyClasses: {
      loggedIn: 'is-logged-in',
      loggedOut: 'is-logged-out',
      signupCompleted: 'signup-completed',
      hasPreviousUser: 'has-previous-user',
      domReady: 'dom-ready'
    },
    identifierAttribute: 'data-login-identifier-key',
    actionAttribute: 'data-action',
    reloadOnLogout: true
  };
}
