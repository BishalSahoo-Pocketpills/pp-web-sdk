/**
 * PII-safe log payload helper.
 *
 * Returns a shape-preserving copy of `value` where:
 *   - Allowlisted keys are passed through verbatim.
 *   - Denylisted keys are replaced with `'<redacted>'`.
 *   - Everything else is replaced by a shape hint string
 *     (`<string len=N>`, `<array len=N>`, `<object keys=N>`).
 *
 * The contract is the log SHAPE, not the values. Log scrapers / dashboards
 * must not parse redacted output to recover content — there is none.
 */

const ALLOWLIST_KEYS: Record<string, true> = {
  country: true,
  language: true,
  gender: true,
  currency: true,
  timezone: true,
  level: true,
  status: true,
  source: true,
  eventname: true,
  formname: true,
  pagepath: true,
  pagetitle: true
};

const DENYLIST_KEYS: Record<string, true> = {
  email: true,
  phone: true,
  phonenumber: true,
  mobile: true,
  firstname: true,
  lastname: true,
  fullname: true,
  name: true,
  dob: true,
  dateofbirth: true,
  birthday: true,
  street: true,
  address: true,
  addressline1: true,
  addressline2: true,
  postal: true,
  postalcode: true,
  zip: true,
  city: true,
  password: true,
  token: true,
  auth: true,
  authtoken: true,
  ssn: true,
  sin: true,
  healthcard: true,
  prescription: true,
  rx: true
};

const MAX_DEPTH = 4;
const MAX_ARRAY = 20;

function normalizeKey(key: string): string {
  // Lowercase + strip non-alphanumeric so `first_name`, `firstName`,
  // `first-name` all collapse to `firstname`.
  let out = '';
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      out += key.charAt(i);
    } else if (c >= 65 && c <= 90) {
      out += String.fromCharCode(c + 32);
    } else if (c >= 97 && c <= 122) {
      out += key.charAt(i);
    }
  }
  return out;
}

function isDeniedRaw(rawKey: string, normalized: string): boolean {
  if (DENYLIST_KEYS[normalized]) return true;
  // Suffix match `_token` / `_auth` runs on the raw lowercased key — the
  // normalized form has all separators stripped, so a `_` suffix can only be
  // detected pre-normalization.
  const lower = rawKey.toLowerCase();
  if (lower.endsWith('_token') || lower.endsWith('_auth')) return true;
  return false;
}

function shapeHint(value: unknown): string {
  if (typeof value === 'string') return '<string len=' + value.length + '>';
  if (Array.isArray(value)) return '<array len=' + value.length + '>';
  if (value && typeof value === 'object') {
    return '<object keys=' + Object.keys(value as Record<string, unknown>).length + '>';
  }
  // Should be unreachable — primitives are returned verbatim by the caller.
  return '<unknown>';
}

function isAllowedValue(value: unknown): boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string' && value.length <= 3) return true;
  return false;
}

function redactObject(
  obj: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > MAX_DEPTH) return '<object truncated>';
  if (seen.has(obj)) return '<circular>';
  seen.add(obj);

  const out: Record<string, unknown> = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const normalized = normalizeKey(key);
    const value = obj[key];

    if (isDeniedRaw(key, normalized)) {
      out[key] = '<redacted>';
      continue;
    }

    if (ALLOWLIST_KEYS[normalized]) {
      out[key] = value;
      continue;
    }

    if (value === null) {
      out[key] = null;
      continue;
    }
    if (value === undefined) {
      out[key] = undefined;
      continue;
    }
    if (isAllowedValue(value)) {
      out[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = redactArray(value, depth + 1, seen);
      continue;
    }

    if (typeof value === 'object') {
      out[key] = redactObject(value as Record<string, unknown>, depth + 1, seen);
      continue;
    }

    // Strings >3 chars and any other unhandled primitives → shape hint.
    out[key] = shapeHint(value);
  }
  return out;
}

function redactArray(arr: unknown[], depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return '<array truncated>';
  if (seen.has(arr)) return '<circular>';
  seen.add(arr);

  const total = arr.length;
  const limit = total > MAX_ARRAY ? MAX_ARRAY : total;
  const out: unknown[] = [];
  for (let i = 0; i < limit; i++) {
    const item = arr[i];
    if (item === null) { out.push(null); continue; }
    if (item === undefined) { out.push(undefined); continue; }
    if (isAllowedValue(item)) { out.push(item); continue; }
    if (Array.isArray(item)) {
      out.push(redactArray(item, depth + 1, seen));
      continue;
    }
    if (typeof item === 'object') {
      out.push(redactObject(item as Record<string, unknown>, depth + 1, seen));
      continue;
    }
    out.push(shapeHint(item));
  }
  if (total > MAX_ARRAY) {
    return '<array len=' + total + ' truncated>';
  }
  return out;
}

export function safeLogPayload(value: unknown): unknown {
  // Top-level primitive passthrough — redaction only kicks in for object/array.
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  const seen = new WeakSet<object>();
  if (Array.isArray(value)) return redactArray(value, 1, seen);
  return redactObject(value as Record<string, unknown>, 1, seen);
}

