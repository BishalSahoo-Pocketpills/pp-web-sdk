/**
 * Recursive partial — every property at every depth is optional.
 *
 * Used for module `configure()` signatures so callers can supply only the
 * fields they want to override at any nesting level:
 *
 *     ppLib.braze.configure({ sdk: { enableLogging: true } });
 *     // sdk.apiKey, sdk.baseUrl, etc. fall through to defaults.
 *
 * The plain `Partial<T>` we used previously made top-level fields optional
 * but required the FULL shape of any nested object the caller did pass,
 * which forced redundant config repetition.
 *
 * Arrays are treated as opaque — supplying an array replaces the default
 * outright (the runtime merge does the same; deep-merging arrays element-
 * wise is rarely what callers want).
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Subresource-Integrity options for any loader that injects a third-party
 * script tag. Braze and Mixpanel configs both pick these up; if a future
 * loader (Google Analytics, Segment, etc.) needs SRI it should extend
 * this same interface so the field names and defaults stay coherent.
 *
 * Default behavior is warn-only — set `integrity` to opt into protection,
 * then flip `requireIntegrity: true` for fail-closed enforcement once a
 * hash has been verified in production. See Track 2 in CHANGELOG.md for
 * the Phase-1 → Phase-3 rollout rationale.
 */
export interface SdkSecurityOptions {
  /**
   * Subresource Integrity hash (e.g. `sha384-…`). When set, the loader
   * emits `<script integrity="…" crossorigin="…">` and the browser
   * refuses to execute the script unless the hash matches.
   *
   * Validated against `^(sha256|sha384|sha512)-<base64>$` at load time;
   * malformed values are rejected with an actionable error rather than
   * silently letting the browser fail SRI.
   */
  integrity?: string;
  /**
   * CORS mode applied alongside `integrity`. Required for SRI on cross-
   * origin scripts. Defaults to 'anonymous' (no cookies) when `integrity`
   * is set. Use 'use-credentials' ONLY if you control the CDN and need
   * cookies sent — for third-party CDNs this leaks domain cookies.
   */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /**
   * Fail-closed switch — refuse to inject the script (and skip stub
   * installation) when no `integrity` hash is configured. Default false
   * keeps existing deploys working while customers stage their SRI
   * rollout.
   */
  requireIntegrity?: boolean;
}
