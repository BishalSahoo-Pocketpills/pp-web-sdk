/**
 * Generate a v4 UUID. Prefers crypto.randomUUID when available (secure
 * contexts), falls back to Math.random-based template with proper v4
 * version/variant bits, then a timestamp-based last resort.
 */
export function generateUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_e) { /* non-secure context — fall through */ }
  try {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  } catch (_e) {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 11);
  }
}
