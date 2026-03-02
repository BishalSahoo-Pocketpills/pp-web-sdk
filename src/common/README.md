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

## Design Patterns

- **Factory functions** — Each utility is created via `create*()` functions that receive dependencies as parameters (dependency injection)
- **Silent failure** — All methods catch exceptions and return safe defaults (null, false, empty string). Errors are logged but never thrown to consumers
- **Namespace isolation** — The IIFE pattern prevents global pollution; only `window.ppLib` is exposed
- **Ready queue** — The `ppLibReady` array enables load-order independence for downstream modules
