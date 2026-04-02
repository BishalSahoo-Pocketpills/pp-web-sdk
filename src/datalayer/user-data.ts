import type { DataLayerUserData, DataLayerUserDataAddress, UserDataInput, UserDataHashedInput } from '@src/types/datalayer.types';

var SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function emptyUserData(): DataLayerUserData {
  return {
    sha256_email_address: '',
    sha256_phone_number: '',
    address: {
      sha256_first_name: '',
      sha256_last_name: '',
      sha256_street: '',
      city: '',
      region: '',
      postal_code: '',
      country: ''
    }
  };
}

async function sha256(value: string): Promise<string> {
  try {
    var encoder = new TextEncoder();
    var data = encoder.encode(value.toLowerCase().trim());
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  } catch (e) {
    return '';
  }
}

async function hashIfNeeded(value: string | undefined): Promise<string> {
  if (!value) return '';
  if (SHA256_PATTERN.test(value)) return value;
  return await sha256(value);
}

export function createUserDataManager() {
  var cached: DataLayerUserData = emptyUserData();

  async function setUserData(raw: UserDataInput): Promise<void> {
    var result = emptyUserData();

    result.sha256_email_address = await hashIfNeeded(raw.email);
    result.sha256_phone_number = await hashIfNeeded(raw.phone);
    result.address.sha256_first_name = await hashIfNeeded(raw.first_name);
    result.address.sha256_last_name = await hashIfNeeded(raw.last_name);
    result.address.sha256_street = await hashIfNeeded(raw.street);
    result.address.city = raw.city || '';
    result.address.region = raw.region || '';
    result.address.postal_code = raw.postal_code || '';
    result.address.country = raw.country || '';

    cached = result;
  }

  function setUserDataHashed(data: UserDataHashedInput): void {
    var result = emptyUserData();

    result.sha256_email_address = data.sha256_email_address || '';
    result.sha256_phone_number = data.sha256_phone_number || '';

    if (data.address) {
      result.address.sha256_first_name = data.address.sha256_first_name || '';
      result.address.sha256_last_name = data.address.sha256_last_name || '';
      result.address.sha256_street = data.address.sha256_street || '';
      result.address.city = data.address.city || '';
      result.address.region = data.address.region || '';
      result.address.postal_code = data.address.postal_code || '';
      result.address.country = data.address.country || '';
    }

    cached = result;
  }

  function getUserData(): DataLayerUserData {
    return cached;
  }

  return {
    setUserData: setUserData,
    setUserDataHashed: setUserDataHashed,
    getUserData: getUserData
  };
}
