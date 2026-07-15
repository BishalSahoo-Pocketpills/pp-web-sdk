import type { DeepPartial } from '@src/types/utility.types';

/** Built-in value sources the module knows how to resolve. */
export type BuiltinSource = 'mixpanel_device_id' | 'mixpanel_distinct_id';

/**
 * Single query parameter definition.
 * Per-param fields override the corresponding top-level config defaults when set.
 */
export interface ParamEntry {
  /** Query parameter name to append. Required. */
  name: string;
  /**
   * Where to read the value from.
   * Built-in: 'mixpanel_device_id' | 'mixpanel_distinct_id'
   * Custom: any () => string function.
   * Required.
   */
  source: BuiltinSource | (() => string);
  /**
   * Per-param domain allowlist. When set, only URLs whose hostname matches one
   * of these entries are decorated with this param, ignoring the top-level
   * allowlist. When absent, falls back to the top-level allowlist.
   */
  allowlist?: string[];
  /**
   * Per-param enable flag. Set to false to disable this param without touching
   * the others. When absent, the param is active (does not inherit enabled).
   */
  enabled?: boolean;
}

export interface UrlDecoratorConfig {
  /** Master on/off switch for the whole module. Default: true. */
  enabled: boolean;
  /**
   * Global allowlist of domain suffixes. Used as the fallback for params that
   * do not define their own allowlist. Only URLs whose hostname equals one of
   * these entries (or is a subdomain) will receive those params.
   * Default: ['pocketpills.com', 'pocketpills.info'].
   */
  allowlist: string[];
  /** Query parameters to append to matching links. Default: one entry for mp_device_id. */
  params: ParamEntry[];
  /** Scan all existing <a> tags on init (after mixpanelReady). Default: true. */
  decorateOnLoad: boolean;
  /** Intercept clicks (capture phase) and decorate the href just before navigation. Default: true. */
  decorateOnClick: boolean;
  /** MutationObserver to decorate <a> tags added dynamically after init. Default: true. */
  watchMutations: boolean;
}

export interface UrlDecoratorAPI {
  configure: (options?: DeepPartial<UrlDecoratorConfig>) => UrlDecoratorConfig;
  init: () => void;
  /** Manually trigger a full page scan and decorate all matching <a> tags. */
  decorate: () => void;
  getConfig: () => UrlDecoratorConfig;
}
