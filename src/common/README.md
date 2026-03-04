# Common Module

Shared foundation for all pp-web-sdk modules. Initializes `window.ppLib` and provides security, storage, cookie, URL, and utility APIs that every other module depends on.

**Output:** `common.min.js` | **Global:** `window.ppLib` | **Load order:** Must load first

---

## Overview

The common module is an IIFE that runs immediately on script load. It:

1. Creates the `window.ppLib` global namespace
2. Initializes configuration, logging, and all shared utilities
3. Processes the `ppLibReady` callback queue (modules that loaded before common)
4. Sets `ppLib._isReady = true` so downstream modules can check readiness

All other modules depend on common and register themselves via the `ppLibReady` queue pattern:

```javascript
// Pattern used by every other module
(function(win) {
  function init() {
    // Module initialization — ppLib is guaranteed to exist here
    ppLib.myModule = { ... };
  }
  if (win.ppLib && win.ppLib._isReady) {
    init();
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(init);
  }
})(window);
```

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — IIFE wrapper, ppLib initialization, ready queue |
| `config.ts` | Configuration factory with defaults |
| `safe-utils.ts` | Null-safe object/array utilities |
| `security.ts` | Input sanitization, URL validation, safe JSON |
| `storage.ts` | sessionStorage/localStorage abstraction |
| `cookies.ts` | Cookie read/delete utilities |
| `url.ts` | URL query parameter extraction |
| `utils.ts` | Deep object merge utility |

---

## Configuration

Default configuration is created by `createConfig()`:

```typescript
{
  debug: false,              // Enable console debug logging
  verbose: false,            // Enable verbose (detailed) logging
  namespace: 'pp_attr',      // Key prefix for Storage operations

  security: {
    maxParamLength: 500,     // Max sanitized string length
    maxStorageSize: 4096,    // Max JSON size for Storage operations
    maxUrlLength: 2048,      // Max URL length for validation
    enableSanitization: true,// Enable input sanitization
    strictMode: false        // Reject any modified input (vs. silently cleaning)
  }
}
```

Configuration can be overridden by downstream modules or page-level scripts:

```javascript
ppLib.config.debug = true;
ppLib.config.security.strictMode = true;
```

---

## API Reference

### Logging

```javascript
ppLib.log('debug', 'Something happened', { key: 'value' });
ppLib.log('verbose', 'Detailed trace info');
```

Logging is silent when `ppLib.config.debug` is `false`. Verbose messages additionally require `ppLib.config.verbose`.

### SafeUtils

Null-safe utilities for working with objects and arrays. Never throws exceptions.

```javascript
// Deep property access — returns 'default' if path doesn't exist
ppLib.SafeUtils.get(obj, 'user.profile.name', 'default');

// Deep property set — creates intermediate objects as needed
ppLib.SafeUtils.set(obj, 'user.settings.theme', 'dark'); // returns true/false

// Check existence (not null, not undefined, not empty string)
ppLib.SafeUtils.exists(value); // boolean

// Safe string conversion
ppLib.SafeUtils.toString(null); // ''
ppLib.SafeUtils.toString(42);   // '42'

// Safe array operations
ppLib.SafeUtils.toArray('hello'); // ['hello']
ppLib.SafeUtils.toArray(null);    // []
ppLib.SafeUtils.forEach(arr, (item) => { ... });
```

### Security

Input validation and sanitization for XSS prevention.

```javascript
// Sanitize user input — strips HTML tags, javascript:, on* handlers, control chars
ppLib.Security.sanitize('<script>alert("xss")</script>');
// → 'alertxss'

// URL validation — http/https only, length-checked
ppLib.Security.isValidUrl('https://example.com'); // true
ppLib.Security.isValidUrl('javascript:alert(1)'); // false

// Safe JSON parse with size validation
ppLib.Security.json.parse('{"key":"value"}', {}); // { key: 'value' }
ppLib.Security.json.parse('invalid', {});          // {} (fallback)

// Safe JSON stringify with size validation
ppLib.Security.json.stringify({ key: 'value' }); // '{"key":"value"}'

// Detect dangerous patterns in object values
ppLib.Security.validateData({ input: '<script>' }); // false (dangerous)
ppLib.Security.validateData({ input: 'hello' });     // true (safe)
```

**Sanitization rules:**
- Removes `<` and `>` characters
- Removes single and double quotes
- Removes `javascript:` protocol
- Removes `on*=` event handlers (onclick, onerror, etc.)
- Removes control characters (0x00-0x1F, 0x7F)
- Removes `data:text/html`
- Truncates to `maxParamLength` (default: 500)

### Storage

Abstraction over `sessionStorage` (default) and `localStorage` (persistent). All keys are prefixed with the configured namespace.

```javascript
// Session storage (default)
ppLib.Storage.set('user_id', '12345');
ppLib.Storage.get('user_id');             // '12345'
ppLib.Storage.remove('user_id');

// Persistent storage (localStorage)
ppLib.Storage.set('first_touch', data, true);
ppLib.Storage.get('first_touch', true);

// Check availability
ppLib.Storage.isAvailable();              // sessionStorage
ppLib.Storage.isAvailable('localStorage');

// Clear SDK-managed keys
ppLib.Storage.clear();
```

**Key prefixing:** `ppLib.Storage.set('user_id', ...)` stores under key `pp_attr_user_id`.

**Security:** Data is validated via `Security.validateData()` before writing and after reading. Corrupted data is automatically removed.

### Cookies

```javascript
ppLib.getCookie('userId');    // cookie value or null
ppLib.deleteCookie('userId'); // sets expiry to 1970 (root + current path)
```

### URL

```javascript
// Case-insensitive parameter extraction
ppLib.getQueryParam('https://example.com?UTM_Source=google', 'utm_source');
// → 'google'
```

### Object Merge

```javascript
// Deep merge — modifies and returns target
ppLib.extend(target, source);
```

Skips `__proto__`, `constructor`, `prototype` keys for prototype pollution prevention. Only copies own properties.

---

## Dependencies

None — this is the foundation module. All other modules depend on it.

## Dependents

All modules: analytics, ecommerce, event-source, login, mixpanel, braze.

---

## Architecture & Design Decisions

### Factory Function Pattern (Not Classes)

Every sub-module is created via `create*()` functions that receive dependencies as parameters:

```typescript
// security.ts
export function createSecurity(config, safeUtils, log): Security { ... }

// storage.ts
export function createStorage(win, config, safeUtils, security, log): Storage { ... }
```

**Why not classes?**
- IIFE output format doesn't benefit from `class` syntax (no prototype chain needed)
- Factory functions with closures produce smaller minified output
- Dependency injection is explicit — no `this` binding issues in event handlers
- V8 inlines closure variables efficiently

**Tradeoff:** Slightly more verbose parameter lists, but each dependency is explicit and testable.

### Ready Queue Pattern

The `ppLibReady` array allows modules to load in any order relative to common:

```
Timeline A: common.js → login.js (synchronous)
Timeline B: login.js → common.js (async/deferred)
```

Both work because login pushes to `ppLibReady` if `ppLib._isReady` isn't set yet, and common drains the queue when it initializes.

**Tradeoff:** Every module must include the 5-line boilerplate check. This is duplicated 7 times across the codebase but ensures complete load-order independence.

### Prototype Pollution Protection

`extend()` explicitly skips `__proto__`, `constructor`, and `prototype` keys:

```typescript
if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
```

**Why:** Every `configure()` call across the SDK passes user-provided objects through `extend()`. Without this guard, an attacker could inject `{ "__proto__": { "isAdmin": true } }` via a data attribute or config object and pollute all objects in the runtime.

### URL Fragment Handling

`getQueryParam()` strips URL fragments before parsing to prevent `#hash` values from leaking into parameter values:

```typescript
const defragmented = url.split('#')[0]; // Strip fragment
const urlSplit = defragmented.split('?');
```

**Why:** `URLSearchParams` does not strip fragments. Without this, `?ref=home#pricing` would return `"home#pricing"` instead of `"home"`.

### Storage Key Namespacing

All storage keys are prefixed with the configured namespace (default: `pp_attr_`):

```
ppLib.Storage.set('user_id', ...) → sessionStorage['pp_attr_user_id']
```

**Tradeoff:** Prevents collisions with other scripts, but means keys are SDK-internal. External tools can't easily inspect stored data without knowing the prefix. The `clear()` method only removes known analytics keys, not all namespaced keys.

---

## Validation & Fallbacks

The common module provides the foundation for all validation and fallback behavior across the SDK. Each utility is designed to fail gracefully with safe defaults.

### SafeUtils Fallbacks

| Method | Invalid Input | Fallback |
|---|---|---|
| `get(obj, path, defaultValue)` | `obj` is null/undefined or path doesn't exist | Returns `defaultValue` (or `undefined` if not provided) |
| `set(obj, path, value)` | `obj` is null/undefined | Returns `false` (no-op) |
| `toString(val)` | `null` or `undefined` | Returns `''` (empty string) |
| `exists(val)` | `null`, `undefined`, or `''` | Returns `false` |
| `toArray(val)` | `null` or `undefined` | Returns `[]` (empty array) |
| `forEach(arr, callback)` | Non-array or non-function callback | No-op (returns `undefined`) |

### Security Validation

| Method | Validation | Warning/Error Logged |
|---|---|---|
| `sanitize(input)` | Strips `<>`, quotes, `javascript:`, `on*=` handlers, control chars, `data:text/html` | `'Rejected suspicious input'` when `strictMode: true` and input was modified |
| `sanitize(input)` | Input exceeds `maxParamLength` | Silently truncated to 500 chars (default) |
| `sanitize(input)` | Non-existent input | Returns `''` |
| `isValidUrl(url)` | Null, non-string, exceeds `maxUrlLength`, or non-http(s) protocol | Returns `false` |
| `json.parse(str)` | Invalid JSON or non-existent string | Returns `fallback` or `null` |
| `json.parse(str)` | Parsed JSON exceeds `maxStorageSize` | `'Data exceeds size limit'` error logged, returns `fallback` |
| `json.stringify(obj)` | Stringified JSON exceeds `maxStorageSize` | `'Data too large to stringify'` error logged, returns `null` |
| `validateData(data)` | Contains `<script>`, `javascript:`, `on*=`, `eval(`, `expression(`, `data:text/html` | `'Dangerous pattern detected'` error logged, returns `false` |

### Storage Fallbacks

| Method | Failure Condition | Fallback |
|---|---|---|
| `isAvailable(type)` | Storage not accessible (private browsing, quota exceeded) | Returns `false` |
| `getKey(key)` | Missing namespace config | Falls back to `'pp_attr_'` prefix |
| `set(key, value)` | Key null/empty, value falsy, storage unavailable, data fails validation, or JSON stringify fails | Returns `false` |
| `get(key)` | Key null/empty, storage unavailable, item not found, or data fails validation | Returns `null`; corrupted data is automatically removed |
| `remove(key)` | Key null/empty or storage unavailable | No-op |
| `clear()` | Any error | `'Storage clear error'` logged |

### Cookie Fallbacks

| Method | Failure Condition | Fallback |
|---|---|---|
| `getCookie(name)` | Name is empty, no cookies, or regex fails | Returns `null` |
| `deleteCookie(name)` | Name is empty or write fails | `'deleteCookie error'` logged |

### URL Fallbacks

| Method | Failure Condition | Fallback |
|---|---|---|
| `getQueryParam(url, param)` | URL or param is empty/null, or parsing fails | Returns `''` (empty string) |

### Logging Fallbacks

| Condition | Behavior |
|---|---|
| `config.debug` is `false` | All log calls are no-ops |
| `config.verbose` is `false` | Verbose-level log calls are no-ops |
| `console[level]` does not exist | Falls back to `console.log` |
| Logging itself throws | Silent catch (logging never crashes the SDK) |

### Extend (Deep Merge) Protections

| Input | Behavior |
|---|---|
| `target` or `source` is null/undefined | Returns `target` or `{}` |
| Key is `__proto__`, `constructor`, or `prototype` | Skipped (prototype pollution prevention) |
| Merge throws | `'Extend error'` logged, returns partial result |

---

## Known Limitations

1. **`deleteCookie()` doesn't specify domain** — Works for same-domain cookies but won't delete cross-subdomain cookies (e.g., `.example.com`). For cross-subdomain deletion, the backend must set the `Domain` attribute.

2. **`sanitize()` strips quotes** — Input like `O'Brien` becomes `OBrien`. This is aggressive but safe. The alternative (HTML entity encoding) would require all consumers to decode, which increases complexity.

3. **`Storage.clear()` is analytics-specific** — It hardcodes `first_touch`, `last_touch`, `session_start` as the keys to clear. Other modules (braze, voucherify) manage their own storage cleanup.

---

## Design Patterns

- **Factory functions** — Each utility is created via `create*()` functions that receive dependencies as parameters (dependency injection)
- **Silent failure** — All methods catch exceptions and return safe defaults (null, false, empty string). Errors are logged but never thrown to consumers
- **Namespace isolation** — The IIFE pattern prevents global pollution; only `window.ppLib` is exposed
- **Ready queue** — The `ppLibReady` array enables load-order independence for downstream modules
