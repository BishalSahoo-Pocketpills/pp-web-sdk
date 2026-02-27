export interface LoginCookieNames {
  userId: string;
  patientId: string;
  auth: string;
  appAuth: string;
  prevUser: string;
  firstName: string;
}

export interface LoginBodyClasses {
  loggedIn: string;
  loggedOut: string;
  signupCompleted: string;
  hasPreviousUser: string;
  domReady: string;
}

export interface LoginConfig {
  cookieNames: LoginCookieNames;
  bodyClasses: LoginBodyClasses;
  identifierAttribute: string;
  actionAttribute: string;
  reloadOnLogout: boolean;
}

export interface LoginAPI {
  configure: (options?: Partial<LoginConfig>) => LoginConfig;
  init: () => void;
  isLoggedIn: () => boolean;
  logout: (hard?: boolean) => void;
  getConfig: () => LoginConfig;
}
