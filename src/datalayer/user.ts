import type { PPLib } from '../types/common.types';
import type { DataLayerConfig, DataLayerUser } from '../types/datalayer.types';

export function createUserBuilder(
  ppLib: PPLib,
  CONFIG: DataLayerConfig
) {
  var overrides: Partial<DataLayerUser> = {};

  function setUser(user: Partial<DataLayerUser>): void {
    overrides = user;
  }

  function buildUser(): DataLayerUser {
    var userId = ppLib.getCookie(CONFIG.cookieNames.userId) || '';
    var patientId = ppLib.getCookie(CONFIG.cookieNames.patientId) || '';
    var appAuth = ppLib.getCookie(CONFIG.cookieNames.appAuth) || '';

    return {
      pp_user_id: overrides.pp_user_id !== undefined ? overrides.pp_user_id : userId,
      pp_patient_id: overrides.pp_patient_id !== undefined ? overrides.pp_patient_id : patientId,
      logged_in: overrides.logged_in !== undefined ? overrides.logged_in : (!!userId && userId !== '-1' && !!patientId && appAuth === 'true')
    };
  }

  return { setUser: setUser, buildUser: buildUser };
}
