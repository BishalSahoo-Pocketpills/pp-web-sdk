export interface MixpanelCookieNames {
  userId: string;
  ipAddress: string;
  experiments: string;
}

export interface MixpanelConfig {
  enabled: boolean;
  token: string;
  projectName: string;
  crossSubdomainCookie: boolean;
  optOutByDefault: boolean;
  sessionTimeout: number;
  cookieNames: MixpanelCookieNames;
}

export interface SessionManager {
  timeout: number;
  generateId: () => string;
  setId: () => void;
  check: () => void;
}

export interface MixpanelAPI {
  configure: (options?: Partial<MixpanelConfig>) => MixpanelConfig;
  init: () => void;
  getMixpanelCookieData: () => Record<string, any>;
  getConfig: () => MixpanelConfig;
}
