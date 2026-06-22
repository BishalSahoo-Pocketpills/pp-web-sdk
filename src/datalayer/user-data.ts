import type { PPLib } from '@src/types/common.types';
import type { DataLayerUserData, UserDataInput, UserDataHashedInput } from '@src/types/datalayer.types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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
    const encoder = new TextEncoder();
    // lowercase + trim ONLY — this matches Google Enhanced Conversions and Meta
    // Advanced Matching email/field normalization exactly. Do NOT add gmail
    // dot/plus stripping: the platforms do not, so stripping would DIVERGE from
    // their hash and reduce match rate.
    const data = encoder.encode(value.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  } catch (e) {
    // crypto.subtle is undefined on non-secure (HTTP) origins; the caller
    // observes the empty result and logs once (see hashField). Returning ''
    // keeps an empty, never-throwing field so one bad hash can't break the
    // whole dataLayer push.
    return '';
  }
}

async function hashIfNeeded(value: string | undefined): Promise<string> {
  if (!value) return '';
  if (SHA256_PATTERN.test(value)) return value;
  return await sha256(value);
}

/**
 * Normalize a phone number's *formatting* before hashing — strip spaces,
 * dashes, parens, dots; preserve a single leading `+`. We deliberately DO NOT
 * fabricate a country code: only numbers that already arrive in E.164 (with a
 * `+`) gain hash parity with Google Enhanced Conversions / Meta Advanced
 * Matching (which normalize to E.164 before SHA-256). National-format numbers
 * are formatting-normalized for consistency but stay un-prefixed — per the
 * product decision to never guess the caller's country — so they will NOT
 * match the platforms' E.164 hash. Caveats: non-ASCII digits are dropped
 * (E.164 is ASCII-only) and extension digits (`x789`) are concatenated, not
 * separated. Already-hashed values pass through untouched (a SHA-256 digest is
 * hex; stripping non-digits would corrupt it).
 */
function normalizePhone(value: string | undefined): string {
  if (!value) return '';
  if (SHA256_PATTERN.test(value)) return value;
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return trimmed.charAt(0) === '+' ? '+' + digits : digits;
}

/**
 * Trust a caller-supplied `sha256_*` value only if it actually looks like a
 * SHA-256 digest. `setUserDataHashed` is for callers who pre-hash; a caller who
 * mistakenly drops cleartext PII into a `sha256_*` field (easy, given the field
 * name) would otherwise leak it to the dataLayer → GTM → ad platforms. Any
 * non-hash value is dropped to '' rather than forwarded.
 */
function passThroughHash(value: string | undefined): string {
  return value && SHA256_PATTERN.test(value) ? value : '';
}

export function createUserDataManager(ppLib: PPLib) {
  let cached: DataLayerUserData = emptyUserData();
  // crypto.subtle absent (non-HTTPS) zeroes EVERY hash field and is invariant
  // for the page lifetime — warn once per manager, not per field per call.
  let cryptoWarned = false;

  // Hash a single field and surface the silent-crypto-failure case: a non-empty
  // input that hashes to '' means crypto.subtle was unavailable — otherwise PII
  // match rates silently drop to zero with no diagnostic.
  async function hashField(value: string | undefined): Promise<string> {
    const out = await hashIfNeeded(value);
    if (value && !out && !cryptoWarned) {
      cryptoWarned = true;
      ppLib.log('warn', '[ppDataLayer] SHA-256 unavailable — user data left unhashed (non-HTTPS context?)');
    }
    return out;
  }

  // Pass a pre-hashed field through, but warn (don't silently swallow) when a
  // non-empty value is dropped because it isn't a SHA-256 digest — that's
  // almost always cleartext PII mistakenly placed in a sha256_* field.
  function checkedHash(value: string | undefined, label: string): string {
    const out = passThroughHash(value);
    if (value && !out) {
      ppLib.log('warn', '[ppDataLayer] ' + label + ' is not a SHA-256 digest — dropped (pre-hash before setUserDataHashed?)');
    }
    return out;
  }

  async function setUserData(raw: UserDataInput): Promise<void> {
    const result = emptyUserData();

    result.sha256_email_address = await hashField(raw.email);
    result.sha256_phone_number = await hashField(normalizePhone(raw.phone));
    result.address.sha256_first_name = await hashField(raw.first_name);
    result.address.sha256_last_name = await hashField(raw.last_name);
    result.address.sha256_street = await hashField(raw.street);
    result.address.city = raw.city || '';
    result.address.region = raw.region || '';
    result.address.postal_code = raw.postal_code || '';
    result.address.country = raw.country || '';

    cached = result;
  }

  function setUserDataHashed(data: UserDataHashedInput): void {
    const result = emptyUserData();

    result.sha256_email_address = checkedHash(data.sha256_email_address, 'sha256_email_address');
    result.sha256_phone_number = checkedHash(data.sha256_phone_number, 'sha256_phone_number');

    if (data.address) {
      result.address.sha256_first_name = checkedHash(data.address.sha256_first_name, 'sha256_first_name');
      result.address.sha256_last_name = checkedHash(data.address.sha256_last_name, 'sha256_last_name');
      result.address.sha256_street = checkedHash(data.address.sha256_street, 'sha256_street');
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
