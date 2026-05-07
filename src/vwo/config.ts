import type { VWOConfig } from '@src/types/vwo.types';

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
    // VWO SmartCode loader URL. The `dev.` subdomain looks suspicious but
    // is VWO's PRODUCTION hostname (per https://help.vwo.com — the prefix
    // is historical, kept for backwards-compat with deployments dating back
    // to VWO's "dev" → "live" promotion model from a decade ago). DO NOT
    // "fix" this to `app.visualwebsiteoptimizer.com` or similar. Overridable
    // via `ppLib.vwo.configure({ smartCodeUrl: '...' })` for testing.
    smartCodeUrl: 'https://dev.visualwebsiteoptimizer.com/j.php'
  };
}
