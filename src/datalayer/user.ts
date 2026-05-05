import type { PPLib } from '@src/types/common.types';
import type { DataLayerConfig, DataLayerUser } from '@src/types/datalayer.types';

export function createUserBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  let overrides: Partial<DataLayerUser> = {};

  function setUser(user: Partial<DataLayerUser>): void {
    overrides = user;
  }

  function buildUser(): DataLayerUser {
    const userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
    const patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
    const appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';

    return {
      pp_user_id: overrides.pp_user_id !== undefined ? overrides.pp_user_id : userId,
      pp_patient_id: overrides.pp_patient_id !== undefined ? overrides.pp_patient_id : patientId,
      logged_in: overrides.logged_in !== undefined ? overrides.logged_in : (appAuth === 'true' || (!!userId && userId !== '-1' && !!patientId))
    };
  }

  return { setUser: setUser, buildUser: buildUser };
}
