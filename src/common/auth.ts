/**
 * Shared authentication constants and derivation utilities.
 *
 * All raw string values are kept private in semantic const maps.
 * Consumers import only the exported functions — never raw literals.
 * If a cookie format or sentinel value changes, update ONE map entry
 * and every consumer adapts automatically.
 *
 * Exported functions and their single responsibilities:
 *   deriveIsLoggedIn  — raw app_is_authenticated cookie value → boolean
 *   isValidUserId     — userId / patientId cookie value → usable-ID guard
 *   toLoggedInString  — boolean auth state → logged_in event property string
 *   isLoggedIn        — logged_in event property string → boolean auth state
 */

// Private — semantic names for raw cookie and property values.
// Never export these; consumers always go through the functions below.

const COOKIE_AUTH_STATE = {
  AUTHENTICATED: 'true',
} as const;

const USER_ID = {
  SENTINEL_LOGGED_OUT: '-1',
} as const;

const USER_STATE = {
  LOGGED_IN: 'true',
  LOGGED_OUT: 'false',
} as const;

/**
 * Derives the authenticated state from the raw `app_is_authenticated`
 * server-set cookie value. Pass `''` when the cookie is absent.
 */
export function deriveIsLoggedIn(appAuth: string): boolean {
  return appAuth === COOKIE_AUTH_STATE.AUTHENTICATED;
}

/**
 * Returns true when a userId or patientId cookie value represents a real
 * authenticated user — non-empty and not the Angular app's logged-out sentinel.
 */
export function isValidUserId(userId: string): boolean {
  if (!userId) return false;
  return userId !== USER_ID.SENTINEL_LOGGED_OUT;
}

/**
 * Serialises the isLoggedIn boolean to the string format carried on
 * `logged_in` event properties. Centralises the format so consumers
 * never hardcode the output string.
 */
export function toLoggedInString(isLoggedIn: boolean): string {
  if (isLoggedIn) return USER_STATE.LOGGED_IN;
  return USER_STATE.LOGGED_OUT;
}

/**
 * Returns true when a `logged_in` event property value represents an
 * authenticated state. Inverse of `toLoggedInString(true)`.
 */
export function isLoggedIn(loggedInValue: string): boolean {
  return loggedInValue === USER_STATE.LOGGED_IN;
}
