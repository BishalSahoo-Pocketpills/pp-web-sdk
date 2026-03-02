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

## Dependencies

- **common** (`window.ppLib`) — getCookie, deleteCookie, Security (sanitize), logging
