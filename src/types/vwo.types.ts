export interface VWOConfig {
  enabled: boolean;
  accountId: string;
  settingsTolerance: number;
  libraryTolerance: number;
  isSPA: boolean;
  hideElement: string;
  queryParam: string;
  sessionStorageKey: string;
  trackToDataLayer: boolean;
}

export interface VWOExperiment {
  campaignId: string;
  variationId: string;
  variationName: string;
}

export interface VWOAPI {
  configure: (options?: Partial<VWOConfig>) => VWOConfig;
  init: () => void;
  getVariation: (campaignId: string) => string | null;
  getActiveExperiments: () => VWOExperiment[];
  forceVariation: (campaignId: string, variationId: string) => void;
  isFeatureEnabled: (campaignId: string) => boolean;
  getConfig: () => VWOConfig;
}
