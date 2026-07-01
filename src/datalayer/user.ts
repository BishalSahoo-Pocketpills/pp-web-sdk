import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerUser } from '@src/types/datalayer.types';
import type { DeepPartial } from '@src/types/utility.types';
import { deriveIsLoggedIn, isValidUserId, toLoggedInString } from '@src/common/auth';

export function createUserBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  let overrides: DeepPartial<DataLayerUser> = {};

  function setUser(user: DeepPartial<DataLayerUser>): void {
    overrides = user;
  }

  function buildUser(): DataLayerUser {
    // Raw cookie reads keep '' as the "missing" form so the logged_in
    // comparison below distinguishes all three states (logged in / explicit
    // -1 sentinel / no cookie). Anonymous / logged-out visitors (no cookie,
    // or the main app's '-1' sentinel) emit `null` at the OUTPUT assignment.
    // dataLayer is never empty-stripped here, so the explicit null is pushed
    // as-is; the Mixpanel path preserves it via the ALLOW_NULL list in
    // `stripEmptyProps`.
    const userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
    const patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';

    return {
      pp_user_id: overrides.pp_user_id !== undefined ? overrides.pp_user_id : (isValidUserId(userId) ? parseInt(userId, 10) : null),
      pp_patient_id: overrides.pp_patient_id !== undefined ? overrides.pp_patient_id : (isValidUserId(patientId) ? parseInt(patientId, 10) : null),
      // Stringified ("true"/"false") per the event-attribute contract.
      // overrides.logged_in already is a string (DataLayerUser typed below);
      // computed value is stringified before the ternary.
      logged_in: overrides.logged_in !== undefined
        ? overrides.logged_in
        : toLoggedInString(deriveIsLoggedIn(appAuth)),
      app_is_authenticated: overrides.app_is_authenticated !== undefined
        ? overrides.app_is_authenticated
        : deriveIsLoggedIn(appAuth)
    };
  }

  return { setUser: setUser, buildUser: buildUser };
}
