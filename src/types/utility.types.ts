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
