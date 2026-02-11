# pp-analytics-lib

Modular analytics library for attribution tracking, Mixpanel integration, login detection, and event source tracking.

## Modules

| Module | File | Description |
|--------|------|-------------|
| **Common** | `common.js` | Shared utilities, security, storage — **load first** |
| **Analytics** | `analytics.js` | UTM/ad attribution, consent, GTM/GA4/Mixpanel event queue |
| **Mixpanel** | `mixpanel.js` | Mixpanel SDK loader, session management, campaign params |
| **Login** | `login.js` | Cookie-based auth detection, body class management, identity DOM injection |
| **Event Source** | `event-source.js` | Auto-track clicks/taps on `data-event-source` elements |

## Installation

### Script Tags (via jsDelivr)

```html
<!-- Always load common first -->
<script defer src="https://cdn.jsdelivr.net/gh/{user}/{repo}@v1.0.0/dist/common.min.js"></script>

<!-- Then load the modules you need -->
<script defer src="https://cdn.jsdelivr.net/gh/{user}/{repo}@v1.0.0/dist/analytics.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/{user}/{repo}@v1.0.0/dist/mixpanel.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/{user}/{repo}@v1.0.0/dist/login.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/{user}/{repo}@v1.0.0/dist/event-source.min.js"></script>
```

### Local Development

```bash
npm install
npm run build
```

## Configuration

### Mixpanel

```html
<script>
  // After common.js and mixpanel.js are loaded:
  ppLib.mixpanel.configure({
    token: 'YOUR_MIXPANEL_TOKEN',
    projectName: 'your-project',
    cookieNames: {
      userId: 'userId',
      ipAddress: 'ipAddress',
      experiments: 'exp'
    }
  });
  ppLib.mixpanel.init();
</script>
```

### Login Detection

```html
<script>
  // Optionally configure cookie names:
  ppLib.login.configure({
    cookieNames: {
      userId: 'userId',
      auth: 'Authorization'
    }
  });
</script>
```

### Event Source Tracking

Add `data-event-source` to any interactive element:

```html
<button data-event-source="signup_cta">Sign Up</button>
<a href="/pricing" data-event-source="pricing_link">View Pricing</a>
```

Optional attributes:

```html
<button
  data-event-source="add_to_cart"
  data-event-category="ecommerce"
  data-event-label="Product Page CTA"
  data-event-value="49.99"
>
  Add to Cart
</button>
```

### Login Identity DOM Injection

Use `data-login-identifier-key` instead of element IDs:

```html
<!-- Before (old): <span id="user-first-name"></span> -->
<span data-login-identifier-key="user-first-name"></span>
```

### Logout Buttons

```html
<button data-action="logout">Log Out</button>
<button data-action="forget-me">Forget Me</button>
```

## API Reference

### `window.ppAnalytics`

- `ppAnalytics.config(options)` — Update analytics configuration
- `ppAnalytics.track(eventName, properties)` — Track custom event
- `ppAnalytics.getAttribution()` — Get first/last touch data
- `ppAnalytics.consent.grant()` / `.revoke()` / `.status()`
- `ppAnalytics.registerPlatform(name, handler)` — Add custom platform
- `ppAnalytics.clear()` — Clear stored attribution data

### `window.ppLib`

- `ppLib.getCookie(name)` — Read a cookie
- `ppLib.deleteCookie(name)` — Delete a cookie
- `ppLib.getQueryParam(url, param)` — Get URL parameter (case-insensitive)
- `ppLib.Storage.set(key, value, persistent)` — Store data
- `ppLib.Storage.get(key, persistent)` — Retrieve data
- `ppLib.Security.sanitize(input)` — Sanitize user input

### `window.ppLib.eventSource`

- `ppLib.eventSource.configure(options)` — Update event source config
- `ppLib.eventSource.trackElement(element)` — Manually track an element
- `ppLib.eventSource.trackCustom(eventSource, properties)` — Track custom event

### `window.ppLib.login`

- `ppLib.login.isLoggedIn()` — Check login status
- `ppLib.login.logout(hard)` — Trigger logout
- `window.logoutUser(hardLogout)` — Global logout function

### `window.ppLib.mixpanel`

- `ppLib.mixpanel.configure(options)` — Set token, project name, etc.
- `ppLib.mixpanel.init()` — Initialize Mixpanel SDK

## Browser Support

Modern browsers (Chrome, Firefox, Safari, Edge). IE11 is not supported.
