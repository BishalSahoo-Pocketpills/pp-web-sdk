import type { VWOConfig } from '../types/vwo.types';

export function createVWOConfig(): VWOConfig {
  return {
    enabled: true,
    accountId: '',
    settingsTolerance: 2000,
    libraryTolerance: 2500,
    isSPA: false,
    hideElement: 'body',
    queryParam: 'vwo',
    sessionStorageKey: 'pp_vwo_force',
    trackToDataLayer: true,
    attributes: {
      goal: 'data-vwo-goal',
      revenue: 'data-vwo-revenue',
      trigger: 'data-vwo-trigger'
    },
    debounceMs: 300,
    smartCodeUrl: 'https://dev.visualwebsiteoptimizer.com/j.php'
  };
}
