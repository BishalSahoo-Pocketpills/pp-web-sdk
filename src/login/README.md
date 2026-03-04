# Login Module

Cookie-based authentication state detection with automatic body class management, identity DOM injection, and logout handling.

**Output:** `login.min.js` + `login.min.css` | **Global:** `ppLib.login` + `window.logoutUser`

---

## Overview

The login module detects whether a user is authenticated by checking for specific cookies, then manages the page UI accordingly:

1. **Body classes** — Adds/removes classes like `is-logged-in`, `is-logged-out`, `has-previous-user` to `<body>`
2. **Identity injection** — Populates `[data-login-identifier-key]` elements with user data from cookies
3. **Visibility control** — Works with `login.min.css` to show/hide `[data-visibility]` elements based on auth state
4. **Logout handling** — Provides soft logout (session only) and hard logout ("forget me" — clears all user data)

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Entry point — IIFE wrapper, ppLib integration, public API |
| `config.ts` | Configuration factory with default cookie names and body classes |
| `auth-state.ts` | Auth state detection, body class application, identity DOM injection |
| `logout.ts` | Logout and forget-me handlers, cookie cleanup |
| `index.css` | Visibility CSS rules for `[data-visibility]` elements |

---

## Quick Start

```html
<link rel="stylesheet" href="login.min.css">
<script src="common.min.js"></script>
<script src="login.min.js"></script>

<!-- Elements auto-show/hide based on auth state -->
<div data-visibility="logged-out">
  <button data-event-source="login_cta">Log In</button>
</div>

<div data-visibility="logged-in">
  Welcome, <span data-login-identifier-key="user-first-name"></span>
  <button data-action="logout">Log Out</button>
</div>
```

The module auto-initializes on `DOMContentLoaded`. No configuration required if default cookie names match your backend.

---

## Body Classes

The module applies these classes to `<body>` based on cookie state:

| Class | Condition |
|---|---|
| `is-logged-in` | `userId` and `Authorization` cookies are present |
| `is-logged-out` | User is not authenticated |
| `signup-completed` | `app_is_authenticated` cookie is present |
| `has-previous-user` | `previousUser` cookie is present (returning user) |
| `dom-ready` | Always added after initialization completes |

All class names are configurable via `ppLib.login.configure()`.

---

## Data Attributes

### Visibility (`data-visibility`)

Control element visibility based on auth state. Requires `login.min.css` to be loaded.

```html
<div data-visibility="logged-in">Only visible when logged in</div>
<div data-visibility="logged-out">Only visible when logged out</div>
<div data-visibility="has-previous-user">Welcome back message</div>
<div data-visibility="signup-completed">Post-signup content</div>
```

**CSS rules** (from `login.min.css`):

```css
body:not(.dom-ready) [data-visibility] { opacity: 0; }
body.is-logged-out [data-visibility="logged-in"] { display: none !important; }
body.is-logged-in [data-visibility="logged-out"] { display: none !important; }
body:not(.has-previous-user) [data-visibility="has-previous-user"] { display: none !important; }
body:not(.signup-completed) [data-visibility="signup-completed"] { display: none !important; }
```

Elements with `[data-visibility]` start hidden (opacity: 0) until `dom-ready` is applied, preventing FOUC.

### Identity Injection (`data-login-identifier-key`)

Inject user data from cookies into DOM elements:

```html
<span data-login-identifier-key="user-first-name"></span>
```

The module reads the `firstName` cookie and sets the element's `textContent`.

### Action Buttons (`data-action`)

```html
<!-- Soft logout: clears session cookies, keeps "remember me" data -->
<button data-action="logout">Log Out</button>

<!-- Hard logout: clears ALL cookies including previous user data -->
<button data-action="forget-me">Forget Me</button>
```

---

## Configuration

```javascript
ppLib.login.configure({
  cookieNames: {
    userId: 'userId',                    // User ID cookie
    patientId: 'patientId',              // Patient ID cookie
    auth: 'Authorization',               // Auth token cookie
    appAuthenticated: 'app_is_authenticated',
    previousUser: 'previousUser',        // Returning user marker
    firstName: 'firstName'               // First name for identity injection
  },

  bodyClasses: {
    loggedIn: 'is-logged-in',
    loggedOut: 'is-logged-out',
    signupCompleted: 'signup-completed',
    previousUser: 'has-previous-user',
    domReady: 'dom-ready'
  },

  identifierAttribute: 'data-login-identifier-key',
  actionAttribute: 'data-action',
  autoReload: true                       // Reload page after logout
});
```

---

## API Reference

### `ppLib.login.configure(options)`

Override default configuration. Accepts `Partial<LoginConfig>`.

### `ppLib.login.init()`

Manually initialize auth state detection and body class application. Called automatically on `DOMContentLoaded`.

### `ppLib.login.isLoggedIn()`

Returns `true` if both `userId` and `Authorization` cookies are present.

```javascript
if (ppLib.login.isLoggedIn()) {
  // user is authenticated
}
```

### `ppLib.login.logout(hard?)`

Trigger logout.

```javascript
ppLib.login.logout();      // Soft — clear session cookies
ppLib.login.logout(true);  // Hard — clear ALL user cookies including previousUser
```

### `ppLib.login.getConfig()`

Returns the current configuration object.

### `window.logoutUser(hardLogout?)`

Global logout function (convenience alias). Available on `window` for use in inline event handlers:

```html
<button onclick="logoutUser()">Log Out</button>
<button onclick="logoutUser(true)">Forget Me</button>
```

---

## Logout Behavior

### Soft Logout (`data-action="logout"`)

1. Deletes session cookies: `userId`, `patientId`, `Authorization`, `app_is_authenticated`
2. Sets `previousUser` cookie (for "welcome back" on next visit)
3. Reloads page (if `autoReload` is enabled)

### Hard Logout / Forget Me (`data-action="forget-me"`)

1. Deletes all session cookies (same as soft logout)
2. Also deletes `previousUser` and `firstName` cookies
3. Reloads page

---

## Architecture & Design Decisions

### CSS + JS Dual Approach for Visibility

The module uses a **two-phase** approach to prevent Flash of Unstyled Content (FOUC):

1. **CSS phase** (`login.min.css` loads first) — Hides all `[data-visibility]` elements via `opacity: 0`
2. **JS phase** (`login.min.js` runs) — Adds body classes, then applies `dom-ready` which restores opacity

```css
body:not(.dom-ready) [data-visibility] { opacity: 0; }
body.is-logged-out [data-visibility="logged-in"] { display: none !important; }
```

**Why:** CSS loads before JavaScript, so `[data-visibility]` elements are invisible from the start. Once JS determines auth state and applies body classes, the CSS rules take over with `display: none` for the wrong state, and `dom-ready` removes the opacity blanket.

**Tradeoff:** Requires loading `login.min.css` in `<head>` (before body renders). If the CSS fails to load, all `[data-visibility]` elements remain visible, which is the safe fallback.

### Cookie-Based Auth Detection

Authentication state is determined by checking `userId` and `Authorization` cookies:

```typescript
const isLoggedIn = userId && userId !== '-1' && authToken && authToken !== '';
```

**Why:** The PocketPills backend sets these cookies on login. The SDK doesn't make API calls to verify auth — it trusts the cookie state. This is appropriate for a Webflow marketing site that shows/hides UI elements but doesn't handle sensitive operations.

**Tradeoff:** If cookies are stale (e.g., expired auth token still present), the module may show "logged in" UI incorrectly. The backend should clear cookies on token expiry to avoid this.

### Idempotent Class Management

`initAuthState()` removes the opposite class before adding the correct one:

```typescript
if (isLoggedIn) {
  doc.body.classList.remove('is-logged-out');
  doc.body.classList.add('is-logged-in');
} else {
  doc.body.classList.remove('is-logged-in');
  doc.body.classList.add('is-logged-out');
}
```

**Why:** Ensures calling `ppLib.login.init()` multiple times doesn't accumulate conflicting body classes. This is important if the module is re-initialized after a soft logout without page reload.

### Soft vs. Hard Logout

Two logout modes handle different user intentions:

| Mode | Clears Session Cookies | Clears `previousUser` | Use Case |
|---|---|---|---|
| Soft (`logout`) | Yes | No | Regular logout — "welcome back" on return |
| Hard (`forget-me`) | Yes | Yes | Privacy-conscious logout — fully clears identity |

**Tradeoff:** `reloadOnLogout: true` (default) means every logout triggers a full page reload. This ensures the server sees the cleared cookies and returns appropriate content. For SPA scenarios, set `reloadOnLogout: false` and handle state updates manually.

### `textContent` for DOM Injection

User names are injected via `textContent` (not `innerHTML`):

```typescript
el.textContent = ppLib.Security.sanitize(previousUserName);
```

**Why:** `textContent` is inherently XSS-safe — it doesn't parse HTML. Combined with `Security.sanitize()`, this provides defense-in-depth: even if sanitization had a gap, `textContent` would render the input as plain text.

---

## Validation & Fallbacks

The login module validates cookie data and handles edge cases in authentication state detection.

### Authentication State Validation

| Cookie | Expected Value | Invalid State Handling |
|---|---|---|
| `userId` | Non-empty string, not `'-1'` | User treated as logged out |
| `Authorization` | Non-empty string | User treated as logged out |
| `app_is_authenticated` | `'true'` | `signup-completed` class not applied |
| `previousUser` | JSON string with `firstName` or `phone` | JSON parse failure logged as error, falls back to `firstName` cookie |
| `firstName` | Any non-empty string | Falls back to no previous user name |

### Cookie Parsing Fallbacks

| Condition | Behavior |
|---|---|
| `previousUser` cookie is invalid JSON | `'Previous user JSON parse error'` logged (error), parsing continues |
| `previousUser` cookie is valid JSON but lacks `firstName` and `phone` | Not treated as having a previous user |
| `firstName` cookie exists (overrides JSON) | Used as fallback for previous user name |
| Both `previousUser` and `firstName` missing | `has-previous-user` class not applied |
| `userId` is `'-1'` | Treated as logged out (backend sentinel value) |

### Identity Injection Validation

| Condition | Behavior |
|---|---|
| User name injected into DOM | Sanitized via `ppLib.Security.sanitize()` before `textContent` set |
| No `[data-login-identifier-key="user-first-name"]` elements | No-op (no error logged) |
| Previous user name is empty after sanitization | Element `textContent` set to empty string |

### Logout Validation

| Condition | Behavior |
|---|---|
| `hardLogout` parameter is not `true` | Defaults to `false` (soft logout) |
| `hardLogout` is truthy but not `true` (e.g., `1`, `'yes'`) | Treated as `false` (strict boolean check: `hardLogout === true`) |
| Cookie deletion fails | `'Logout error'` logged (error) |
| `reloadOnLogout` is `false` | Page does not reload after logout |

### Body Class Safety

| Condition | Behavior |
|---|---|
| `initAuthState()` called multiple times | Idempotent: removes opposite class before adding correct one |
| `dom-ready` class | Always applied after initialization (even on error recovery) |
| Body element not available | `'initAuthState error'` logged (error), function exits gracefully |

### Action Binding Validation

| Condition | Behavior |
|---|---|
| No `[data-action="logout"]` elements | No listeners bound (no error) |
| No `[data-action="forget-me"]` elements | No listeners bound (no error) |
| Button click handler fails | `'bindActions error'` logged (error) |

---

## Known Limitations

1. **No real-time cookie watching** — Auth state is checked once on `DOMContentLoaded`. If the user logs in/out in another tab, the current tab won't update until a page reload.

2. **`previousUser` cookie parsing assumes specific format** — Supports both JSON (`{ firstName: "...", phone: "..." }`) and plain string formats. Other formats will be silently ignored.

3. **`logoutUser` is a global function** — Exposed on `window` for inline `onclick` handlers. This is intentional for Webflow's no-code environment but pollutes the global namespace.

---

## Dependencies

- **common** (`window.ppLib`) — getCookie, deleteCookie, Security (sanitize), extend, logging
