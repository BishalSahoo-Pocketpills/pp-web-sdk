/**
 * Shared authentication constants and derivation utilities.
 *
 * All raw string values are kept private in semantic const maps.
 * Consumers import only the exported functions — never raw literals.
 * If a cookie format or sentinel value changes, update ONE map entry
 * and every consumer adapts automatically.
 *
 * Two distinct auth concepts — exported as separate derivation functions:
 *
 *   deriveLoggedIn        — userId cookie → logged_in boolean
 *                           True when the user is or was logged in (persists
 *                           across sessions; does NOT require an active token).
 *   deriveIsAuthenticated — app_is_authenticated cookie → boolean
 *                           True only when the auth token is currently valid
 *                           (active session; server-set).
 *
 * Supporting utilities:
 *   isValidUserId     — guard: userId / patientId value is a real user ID
 *   toLoggedInString  — boolean → logged_in event property string
 *   isLoggedIn        — logged_in event property string → boolean
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
 * Returns true when a userId or patientId cookie value represents a real
 * user — non-empty and not the Angular app's logged-out sentinel (-1).
 * Use as a guard for pp_user_id / pp_patient_id presence checks.
 */
export function isValidUserId(userId: string): boolean {
  if (!userId) return false;
  return userId !== USER_ID.SENTINEL_LOGGED_OUT;
}

/**
 * Derives the `logged_in` event property from the raw `userId` cookie value.
 * Returns true when the user is or was logged in — i.e. a real userId exists.
 * This persists across sessions and does NOT require an active auth token.
 * Pass `''` when the cookie is absent.
 */
export function deriveLoggedIn(userId: string): boolean {
  return isValidUserId(userId);
}

/**
 * Derives the `app_is_authenticated` event property from the raw
 * `app_is_authenticated` server-set cookie value. Returns true only when
 * the auth token is currently valid — an active authenticated session.
 * Pass `''` when the cookie is absent.
 */
export function deriveIsAuthenticated(appAuth: string): boolean {
  return appAuth === COOKIE_AUTH_STATE.AUTHENTICATED;
}

/**
 * Serialises a logged_in boolean to the string format carried on
 * `logged_in` event properties. Centralises the format so consumers
 * never hardcode the output string.
 */
export function toLoggedInString(isLoggedIn: boolean): string {
  if (isLoggedIn) return USER_STATE.LOGGED_IN;
  return USER_STATE.LOGGED_OUT;
}

/**
 * Returns true when a `logged_in` event property value represents a
 * logged-in state. Inverse of `toLoggedInString(true)`.
 */
export function isLoggedIn(loggedInValue: string): boolean {
  return loggedInValue === USER_STATE.LOGGED_IN;
}
