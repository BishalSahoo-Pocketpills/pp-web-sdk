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
    const userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
    const patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';

    return {
      pp_user_id: overrides.pp_user_id !== undefined ? overrides.pp_user_id : userId,
      pp_patient_id: overrides.pp_patient_id !== undefined ? overrides.pp_patient_id : patientId,
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
