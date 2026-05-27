/**
 * Default value for a UTM parameter when the URL doesn't carry it.
 * utm_content and utm_term default to 'none' (no creative/keyword context);
 * everything else defaults to '$direct' (canonical direct-traffic marker).
 */
export function utmFallback(key: string): string {
  return key === 'utm_content' || key === 'utm_term' ? 'none' : '$direct';
}
