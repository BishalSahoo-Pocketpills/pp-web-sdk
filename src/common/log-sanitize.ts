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

// camelCase source-of-truth for the rule sets. Common variants are listed
// explicitly rather than relying on substring matching (substring would
// over-redact, e.g. `countryName` would incorrectly hit a `name` substring).
// `normalizeKey()` populates the lookup tables once at module init so that
// runtime comparisons stay O(1) regardless of key casing/separators in the
// caller's payload (`firstName`, `first_name`, `first-name` all match).

const ALLOWLIST_SOURCE: readonly string[] = [
  'country',
  'language',
  'gender',
  'currency',
  'timezone',
  'level',
  'status',
  'source',
  'eventName',
  'formName',
  'pagePath',
  'pageTitle'
];

const DENYLIST_SOURCE: readonly string[] = [
  // contact
  'email',
  'emailAddress',
  'userEmail',
  'customerEmail',
  'personalEmail',
  'phone',
  'phoneNumber',
  'phoneE164',
  'mobile',
  'mobileNumber',
  'mobilePhone',
  'cell',
  'cellPhone',
  'homePhone',
  'workPhone',
  // identity
  'firstName',
  'lastName',
  'fullName',
  'middleName',
  'name',
  'userName',
  'dob',
  'dateOfBirth',
  'birthday',
  // address
  'street',
  'streetAddress',
  'address',
  'addressLine1',
  'addressLine2',
  'postal',
  'postalCode',
  'zip',
  'zipCode',
  'city',
  // credentials / tokens
  'password',
  'passwd',
  'pwd',
  'token',
  'accessToken',
  'refreshToken',
  'bearerToken',
  'apiKey',
  'apiToken',
  'secret',
  'clientSecret',
  'clientSecretKey',
  'auth',
  'authToken',
  'authorization',
  // sensitive identifiers (PHI / govt)
  'ssn',
  'sin',
  'healthCard',
  'prescription',
  'rx'
];

const ALLOWLIST_KEYS: Record<string, true> = ALLOWLIST_SOURCE.reduce((acc, k) => {
  acc[normalizeKey(k)] = true;
  return acc;
}, {} as Record<string, true>);

const DENYLIST_KEYS: Record<string, true> = DENYLIST_SOURCE.reduce((acc, k) => {
  acc[normalizeKey(k)] = true;
  return acc;
}, {} as Record<string, true>);

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
      // An allowlisted key still recurses through container values so a
      // payload like `{ source: { email: '...' } }` doesn't pass PII through
      // verbatim. Primitive values pass straight through.
      if (Array.isArray(value)) {
        out[key] = redactArray(value, depth + 1, seen);
      } else if (value !== null && typeof value === 'object') {
        out[key] = redactObject(value as Record<string, unknown>, depth + 1, seen);
      } else {
        out[key] = value;
      }
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

/**
 * PII-safe error logging helper.
 *
 * Returns a plain object describing an exception in a shape that is safe to
 * write to console / DevTools / Sentry. Free-form fields (the message, the
 * stack, arbitrary `cause` chains) are dropped or replaced by shape hints —
 * exception text is one of the most common PII leak vectors because it
 * frequently embeds emails, tokens, and request payloads.
 *
 * Always returns a plain `Record<string, unknown>` and never throws — log
 * sites must remain "fire and forget".
 *
 * Optional `opts.debugErrors: true` includes verbatim `messageRaw` and
 * `stack`. Intended for local debug builds only. The runtime config flag
 * `CONFIG.debugErrors` is forwarded by the common-module installer; callers
 * that bypass `ppLib.safeLogError` and import this helper directly may pass
 * the option explicitly.
 */
export interface SafeLogErrorOptions {
  debugErrors?: boolean;
}

interface ErrorWithContext {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  code?: unknown;
  context?: unknown;
}

export function safeLogError(
  err: unknown,
  opts?: SafeLogErrorOptions
): Record<string, unknown> {
  const debug = !!(opts && opts.debugErrors);

  if (err instanceof Error) {
    const e = err as Error & ErrorWithContext;
    const out: Record<string, unknown> = {
      errorClass: (typeof e.name === 'string' && e.name) || 'Error',
      messageShape: typeof e.message === 'string'
        ? '<string len=' + e.message.length + '>'
        : '<unknown>'
    };

    // DOMException-style numeric `code`. Booleans excluded (`typeof true ===
    // 'boolean'`); we accept numbers only.
    if (typeof e.code === 'number') {
      out.code = e.code;
    }

    if (e.context !== null && typeof e.context === 'object') {
      const ctx = e.context as Record<string, unknown>;
      // Lift well-known typed-error keys verbatim with strict type checks.
      // Anything that doesn't match the expected primitive type is dropped
      // (not coerced) so a future caller stuffing an Error.cause object into
      // `cause` doesn't recurse PII through.
      if (typeof ctx.endpoint === 'string') out.endpoint = ctx.endpoint;
      if (typeof ctx.status === 'number') out.status = ctx.status;
      if (typeof ctx.attempt === 'number') out.attempt = ctx.attempt;
      if (typeof ctx.cause === 'string') out.cause = ctx.cause;

      // Build remainder map of any custom keys (anything beyond the four
      // typed-error fields above) and run it through safeLogPayload — this
      // closes the H-3 loophole where future callers might add PII into the
      // free-form `[key: string]: unknown` slot of VoucherifyErrorContext.
      const rest: Record<string, unknown> = {};
      let hasRest = false;
      const keys = Object.keys(ctx);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === 'endpoint' || k === 'status' || k === 'attempt' || k === 'cause') continue;
        rest[k] = ctx[k];
        hasRest = true;
      }
      if (hasRest) {
        out.context = safeLogPayload(rest);
      }
    }

    if (debug) {
      out.messageRaw = typeof e.message === 'string' ? e.message : String(e.message);
      out.stack = typeof e.stack === 'string' ? e.stack : undefined;
    }

    return out;
  }

  // Non-Error throws. JS allows `throw <anything>` so log sites can receive
  // primitives, plain objects, null, or undefined.
  if (err === null) {
    return { errorClass: 'null' };
  }
  if (err === undefined) {
    return { errorClass: 'undefined' };
  }
  const t = typeof err;
  if (t === 'string') {
    return {
      errorClass: 'string',
      primitive: 'string',
      messageShape: shapeHint(err)
    };
  }
  if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
    return {
      errorClass: t,
      primitive: t
    };
  }
  if (t === 'object') {
    return {
      errorClass: 'Object',
      context: safeLogPayload(err)
    };
  }
  // Functions and any other exotic type — degrade gracefully.
  return { errorClass: t };
}

