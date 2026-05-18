import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerUser } from '@src/types/datalayer.types';
import type { DeepPartial } from '@src/types/utility.types';

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
    // -1 sentinel / no cookie). The '-1' sentinel is only applied at the
    // OUTPUT assignment so the field survives downstream empty-string
    // stripping (3E) and stays queryable in Mixpanel / GA4.
    const userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
    const patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';

    return {
      pp_user_id: overrides.pp_user_id !== undefined ? overrides.pp_user_id : (userId || '-1'),
      pp_patient_id: overrides.pp_patient_id !== undefined ? overrides.pp_patient_id : (patientId || '-1'),
      // Stringified ("true"/"false") per the event-attribute contract.
      // overrides.logged_in already is a string (DataLayerUser typed below);
      // computed value is stringified before the ternary.
      logged_in: overrides.logged_in !== undefined
        ? overrides.logged_in
        : ((appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId)) ? 'true' : 'false')
    };
  }

  return { setUser: setUser, buildUser: buildUser };
}
