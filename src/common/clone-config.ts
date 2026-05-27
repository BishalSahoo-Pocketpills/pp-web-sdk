/**
 * Deep-clone a config object for read-only exposure via getConfig().
 * Uses JSON round-trip — drops undefined values and functions, which
 * is the intended behavior (configs are plain data, not callable).
 */
export function cloneConfig<T>(config: T): T {
  return JSON.parse(JSON.stringify(config));
}
