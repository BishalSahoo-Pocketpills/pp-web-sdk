import type { DeepPartial } from '@src/types/utility.types';

/**
 * @deprecated Use descriptor sources instead:
 *   'mixpanel_device_id'  → 'mixpanel:primary:$device_id'
 *   'mixpanel_distinct_id' → 'mixpanel:primary:distinct_id'
 * These opaque strings remain supported for backward compatibility.
 */
export type BuiltinSource = 'mixpanel_device_id' | 'mixpanel_distinct_id';

/**
 * Descriptor-style source strings. Format: `storage_type:key` or `storage_type:key:json_field`
 *
 *   query_params:utm_source
 *     — read utm_source from the current page URL; omits param if absent
 *
 *   cookies:pp_segment
 *     — raw cookie string value
 *
 *   cookies:mp_<token>_mixpanel:$device_id
 *     — parse mp_<token>_mixpanel cookie as JSON, return the $device_id field
 *     — caller supplies the actual token value; no runtime substitution
 *
 *   localstorage:mp_<token>_mixpanel:$device_id
 *     — same but from localStorage
 *
 *   mixpanel:primary:$device_id
 *     — reads $device_id from the primary Mixpanel instance's storage
 *     — resolves the token from ppLib.mixpanel.primary.getConfig() at runtime;
 *       no hardcoded token needed
 *
 *   mixpanel:secondary:$device_id
 *     — same for the secondary instance (localStorage-persisted)
 *
 *   mixpanel:primary:distinct_id | mixpanel:secondary:distinct_id
 *     — reads distinct_id from the respective instance's storage
 */
export type DescriptorSource =
  | `query_params:${string}`
  | `cookies:${string}`
  | `localstorage:${string}`
  | `mixpanel:${'primary' | 'secondary'}:${string}`;

/**
 * Single query parameter definition.
 * Per-param fields override the corresponding top-level config defaults when set.
 */
export interface ParamEntry {
  /** Query parameter name to append. Required. */
  name: string;
  /**
   * Where to read the value from.
   * Built-in strings: 'mixpanel_device_id' | 'mixpanel_distinct_id'
   * Descriptor strings: 'query_params:key', 'cookies:key[:json_field]',
   *   'localstorage:key[:json_field]'
   * Custom function: any () => string.
   * Required.
   */
  source: BuiltinSource | DescriptorSource | (() => string);
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
  /** When true, all module log calls are emitted. Default: false. */
  debug: boolean;
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
