import { safeLogPayload } from '../../src/common/log-sanitize';

describe('safeLogPayload — top-level passthrough', () => {
  it('passes a top-level string through unchanged', () => {
    expect(safeLogPayload('hi')).toBe('hi');
  });

  it('passes a top-level long string through unchanged (passthrough is structural)', () => {
    // Top-level primitives are emitted by callers as message strings, not
    // user-attribute bags — passthrough is intentional.
    expect(safeLogPayload('a longer string than three chars')).toBe('a longer string than three chars');
  });

  it('passes a top-level number through unchanged', () => {
    expect(safeLogPayload(42)).toBe(42);
  });

  it('passes a top-level boolean through unchanged', () => {
    expect(safeLogPayload(true)).toBe(true);
    expect(safeLogPayload(false)).toBe(false);
  });

  it('passes null through', () => {
    expect(safeLogPayload(null)).toBe(null);
  });

  it('passes undefined through', () => {
    expect(safeLogPayload(undefined)).toBe(undefined);
  });
});

describe('safeLogPayload — denylist (case + separator-insensitive)', () => {
  const denyKeys = [
    'email', 'EMAIL', 'Email',
    'phone', 'phoneNumber', 'phone_number', 'phone-number', 'PhoneNumber',
    'mobile',
    'firstName', 'first_name', 'first-name', 'firstname',
    'lastName', 'last_name', 'lastname',
    'fullName', 'full_name',
    'name',
    'dob', 'dateOfBirth', 'date_of_birth', 'birthday',
    'street',
    'address', 'addressLine1', 'address_line_1', 'addressLine2',
    'postal', 'postalCode', 'postal_code', 'zip',
    'city',
    'password',
    'token', 'auth', 'authToken', 'auth_token',
    'ssn', 'sin',
    'healthCard', 'health_card',
    'prescription', 'rx'
  ];

  for (const key of denyKeys) {
    it('redacts ' + key + ' to <redacted>', () => {
      const out = safeLogPayload({ [key]: 'sensitive value here' }) as Record<string, unknown>;
      expect(out[key]).toBe('<redacted>');
    });
  }
});

describe('safeLogPayload — _token / _auth suffix matching', () => {
  it('redacts session_token', () => {
    const out = safeLogPayload({ session_token: 'abc123xyz' }) as Record<string, unknown>;
    expect(out.session_token).toBe('<redacted>');
  });

  it('redacts api_auth', () => {
    const out = safeLogPayload({ api_auth: 'bearer-secret' }) as Record<string, unknown>;
    expect(out.api_auth).toBe('<redacted>');
  });

  it('redacts uppercase SESSION_TOKEN', () => {
    const out = safeLogPayload({ SESSION_TOKEN: 'abc123xyz' }) as Record<string, unknown>;
    expect(out.SESSION_TOKEN).toBe('<redacted>');
  });

  it('does not redact `tokenizer` (no _token suffix)', () => {
    const out = safeLogPayload({ tokenizer: 'pickle' }) as Record<string, unknown>;
    // Not in denylist (key `tokenizer` !== `token`, no `_token` suffix), not
    // allowlisted, value length>3 → shape hint.
    expect(out.tokenizer).toBe('<string len=6>');
  });
});

describe('safeLogPayload — allowlist (verbatim)', () => {
  const allowKeys = [
    'country', 'language', 'gender', 'currency', 'timezone',
    'level', 'status', 'source', 'event_name', 'form_name',
    'page_path', 'page_title'
  ];

  for (const key of allowKeys) {
    it('passes ' + key + ' verbatim', () => {
      const out = safeLogPayload({ [key]: 'a value longer than three chars' }) as Record<string, unknown>;
      expect(out[key]).toBe('a value longer than three chars');
    });
  }

  it('matches case-insensitively (Country, EVENT_NAME)', () => {
    const out = safeLogPayload({ Country: 'Canada', EVENT_NAME: 'page_view_long' }) as Record<string, unknown>;
    expect(out.Country).toBe('Canada');
    expect(out.EVENT_NAME).toBe('page_view_long');
  });
});

describe('safeLogPayload — value-type allowances', () => {
  it('preserves boolean values for any key', () => {
    const out = safeLogPayload({ randomKey: true, other: false }) as Record<string, unknown>;
    expect(out.randomKey).toBe(true);
    expect(out.other).toBe(false);
  });

  it('preserves number values for any key', () => {
    const out = safeLogPayload({ randomKey: 42, count: 0 }) as Record<string, unknown>;
    expect(out.randomKey).toBe(42);
    expect(out.count).toBe(0);
  });

  it('preserves strings of length <=3 for any key (likely codes)', () => {
    const out = safeLogPayload({ province: 'ON', regionCode: 'CA', empty: '' }) as Record<string, unknown>;
    expect(out.province).toBe('ON');
    expect(out.regionCode).toBe('CA');
    expect(out.empty).toBe('');
  });

  it('replaces longer unknown strings with shape hint', () => {
    const out = safeLogPayload({ pharmacy_name: 'Downtown Pharmacy' }) as Record<string, unknown>;
    expect(out.pharmacy_name).toBe('<string len=17>');
  });

  it('preserves null and undefined verbatim', () => {
    const out = safeLogPayload({ a: null, b: undefined }) as Record<string, unknown>;
    expect(out.a).toBe(null);
    expect(out.b).toBe(undefined);
  });
});

describe('safeLogPayload — nested objects and arrays', () => {
  it('recurses into nested objects', () => {
    const out = safeLogPayload({
      profile: {
        email: 'x@y.com',
        country: 'Canada'
      }
    }) as Record<string, Record<string, unknown>>;
    expect(out.profile.email).toBe('<redacted>');
    expect(out.profile.country).toBe('Canada');
  });

  it('emits shape hint for unknown nested object as top-level value when key is not allowlisted', () => {
    // Nested object under an unknown (non-allow, non-deny) key recurses.
    const out = safeLogPayload({
      user: { firstName: 'Bob', country: 'CA' }
    }) as Record<string, Record<string, unknown>>;
    expect(out.user.firstName).toBe('<redacted>');
    expect(out.user.country).toBe('CA');
  });

  it('caps array at 20 elements with truncation marker', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const out = safeLogPayload({ items: arr }) as Record<string, unknown>;
    expect(out.items).toBe('<array len=25 truncated>');
  });

  it('preserves arrays of length <=20 with element-level redaction', () => {
    const arr = [{ email: 'a@b.com', country: 'CA' }, { firstName: 'Bob', currency: 'USD' }];
    const out = safeLogPayload({ items: arr }) as Record<string, unknown[]>;
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[0].email).toBe('<redacted>');
    expect(items[0].country).toBe('CA');
    expect(items[1].firstName).toBe('<redacted>');
    expect(items[1].currency).toBe('USD');
  });

  it('handles arrays of primitives at top-level', () => {
    const out = safeLogPayload([1, 2, 3, true, 'CA']);
    expect(out).toEqual([1, 2, 3, true, 'CA']);
  });

  it('emits shape hint for long strings inside arrays', () => {
    const out = safeLogPayload(['hello world', 'CA']) as unknown[];
    expect(out[0]).toBe('<string len=11>');
    expect(out[1]).toBe('CA');
  });

  it('preserves null and undefined inside arrays', () => {
    const out = safeLogPayload([null, undefined, 1]) as unknown[];
    expect(out[0]).toBe(null);
    expect(out[1]).toBe(undefined);
    expect(out[2]).toBe(1);
  });
});

describe('safeLogPayload — depth cap', () => {
  it('truncates objects past depth 4', () => {
    const deep = { a: { b: { c: { d: { e: 'leaf' } } } } };
    // safeLogPayload calls redactObject(deep, 1). Recursion depth grows by 1
    // per nested object. The 5th nested level (d's value `{ e: ... }`) is
    // visited via redactObject(_, 5) which exceeds the cap and returns the
    // truncation marker — so c.d is replaced.
    const out = safeLogPayload(deep) as Record<string, unknown>;
    const a = out.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    const c = b.c as Record<string, unknown>;
    expect(c.d).toBe('<object truncated>');
  });

  it('truncates nested arrays past depth 4', () => {
    const deep = { a: { b: { c: { d: [[[[1]]]] } } } };
    // d at depth 4; redactArray called with depth=5 → '<array truncated>'.
    const out = safeLogPayload(deep) as Record<string, unknown>;
    const a = out.a as Record<string, unknown>;
    const b = a.b as Record<string, unknown>;
    const c = b.c as Record<string, unknown>;
    expect(c.d).toBe('<array truncated>');
  });
});

describe('safeLogPayload — circular refs', () => {
  it('handles a self-referencing object without stack overflow', () => {
    const obj: Record<string, unknown> = { country: 'CA' };
    obj.self = obj;
    const out = safeLogPayload(obj) as Record<string, unknown>;
    expect(out.country).toBe('CA');
    expect(out.self).toBe('<circular>');
  });

  it('handles a self-referencing array without stack overflow', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    const out = safeLogPayload(arr) as unknown[];
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(2);
    expect(out[2]).toBe('<circular>');
  });
});

describe('safeLogPayload — composite Braze-style payload', () => {
  it('redacts PII fields and keeps allowlisted context', () => {
    const out = safeLogPayload({
      email: 'x@y.com',
      firstName: 'Bob',
      lastName: 'Builder',
      country: 'Canada',
      currency: 'CAD',
      gender: 'M',
      pharmacy: 'Downtown',
      loyalty_tier: 'gold',
      session_token: 'abc.def.ghi'
    }) as Record<string, unknown>;
    expect(out.email).toBe('<redacted>');
    expect(out.firstName).toBe('<redacted>');
    expect(out.lastName).toBe('<redacted>');
    expect(out.country).toBe('Canada');
    expect(out.currency).toBe('CAD');
    expect(out.gender).toBe('M');
    expect(out.pharmacy).toBe('<string len=8>');
    expect(out.loyalty_tier).toBe('<string len=4>');
    expect(out.session_token).toBe('<redacted>');
  });
});

describe('safeLogPayload — denylist variant coverage (review fix H-1)', () => {
  // Common camelCase / snake_case / compound variants of the canonical
  // denylist keys. The normalize step collapses casing/separators so each
  // variant maps onto an entry in DENYLIST_KEYS.
  const variants: Record<string, string> = {
    emailAddress: 'a@b.com',
    user_email: 'a@b.com',
    customerEmail: 'a@b.com',
    personalEmail: 'a@b.com',
    'phone-number': '555-1234',
    phoneE164: '+15551234',
    mobilePhone: '555-1234',
    mobile_number: '555-1234',
    cellPhone: '555-1234',
    home_phone: '555-1234',
    workPhone: '555-1234',
    user_name: 'bob',
    middle_name: 'Q',
    full_name: 'Bob Q. Builder',
    streetAddress: '123 Main St',
    zipCode: '94110',
    accessToken: 'tk',
    refresh_token: 'tk',
    bearerToken: 'tk',
    apiKey: 'tk',
    apiToken: 'tk',
    clientSecret: 'tk',
    client_secret_key: 'tk',
    authorization: 'Bearer x'
  };
  Object.keys(variants).forEach((rawKey) => {
    it('redacts ' + rawKey, () => {
      const out = safeLogPayload({ [rawKey]: variants[rawKey] }) as Record<string, unknown>;
      expect(out[rawKey]).toBe('<redacted>');
    });
  });
});

describe('safeLogPayload — allowlisted-key recursion (review fix M-5)', () => {
  it('recurses into an allowlisted key whose value is an object', () => {
    // `source` is allowlisted but the inner `email` must still be redacted —
    // an allowlisted KEY does not whitelist its CONTAINER's contents.
    const out = safeLogPayload({
      source: { email: 'x@y.com', country: 'CA' }
    }) as Record<string, unknown>;
    const inner = out.source as Record<string, unknown>;
    expect(inner.email).toBe('<redacted>');
    expect(inner.country).toBe('CA');
  });

  it('recurses into an allowlisted key whose value is an array of objects', () => {
    const out = safeLogPayload({
      source: [{ email: 'x@y.com' }, { country: 'CA' }]
    }) as Record<string, unknown>;
    const arr = out.source as Array<Record<string, unknown>>;
    expect(arr[0].email).toBe('<redacted>');
    expect(arr[1].country).toBe('CA');
  });
});

describe('safeLogPayload — idempotency + serialization (review fixes L-2/L-3)', () => {
  it('is idempotent on allowlist + denylist values', () => {
    // Values that have already been redacted (`<redacted>`) or are
    // allowlisted strings stay stable under a second pass. Shape-hint
    // strings (`<string len=N>`) are intentionally NOT idempotent —
    // re-running produces `<string len=14>` because the prior hint is
    // itself a string longer than 3 chars. That's an acceptable cost; the
    // helper's contract is "no PII in output", not "stable encoding".
    const payload = {
      email: 'x@y.com',
      firstName: 'Bob',
      country: 'CA',
      gender: 'M'
    };
    const once = safeLogPayload(payload);
    const twice = safeLogPayload(once);
    expect(twice).toEqual(once);
  });

  it('produces JSON.stringify-safe output without leaking redacted values', () => {
    const out = safeLogPayload({
      email: 'leaky@example.com',
      firstName: 'Bob',
      session_token: 'sekret-value-12345',
      country: 'CA'
    });
    // No throw on serialization — Sentry / DataDog ingestion won't choke.
    expect(() => JSON.stringify(out)).not.toThrow();
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('leaky@example.com');
    expect(serialized).not.toContain('Bob');
    expect(serialized).not.toContain('sekret-value-12345');
    // Allowlisted CA still surfaces.
    expect(serialized).toContain('CA');
  });
});
