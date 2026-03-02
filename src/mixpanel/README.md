# Mixpanel Module

Mixpanel SDK loader with session management, UTM attribution tracking, experiment parsing, and cookie-based identity.

**Output:** `mixpanel.min.js` | **Global:** `ppLib.mixpanel`

---

## Overview

The Mixpanel module handles the full lifecycle of Mixpanel integration:

1. **SDK loading** — Dynamically loads the Mixpanel JavaScript SDK from CDN
2. **Session management** — 30-minute rolling sessions with UUID session IDs
3. **UTM attribution** — First/last touch UTM parameter and ad click ID tracking
4. **Identity** — Cookie-based user identification (userId, IP address)
5. **Experiments** — Parses experiment cookies and registers as super properties
6. **Track patching** — Monkey-patches `mixpanel.track()` to check session state on every event

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Single-file module — SDK loader, session manager, attribution, identity, init |

---

## Quick Start

```html
<script src="common.min.js"></script>
<script src="mixpanel.min.js"></script>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    ppLib.mixpanel.configure({
      token: 'YOUR_MIXPANEL_TOKEN',
      projectName: 'your-project'
    });
    ppLib.mixpanel.init();
  });
</script>
```

---

## Configuration

```javascript
ppLib.mixpanel.configure({
  token: '',                         // Mixpanel project token (required)
  projectName: '',                   // Custom project label
  crossSubdomainCookie: true,        // Enable cross-subdomain tracking
  optOutByDefault: false,            // Opt-out tracking by default
  sessionTimeout: 1800000,           // Session timeout in ms (30 minutes)

  cookieNames: {
    userId: 'userId',                // Cookie for user identification
    ipAddress: 'ipAddress',          // Cookie for IP-based identification
    experiments: 'exp'               // Cookie for A/B experiment data (JSON)
  }
});
```

### Required Configuration

Only `token` is required. All other options have sensible defaults.

---

## API Reference

### `ppLib.mixpanel.configure(options)`

Set configuration before initialization. The `token` must be set before calling `init()`. Accepts `Partial<MixpanelConfig>`.

### `ppLib.mixpanel.init()`

Initialize the Mixpanel SDK:

1. Loads the Mixpanel JS library from CDN
2. Calls `mixpanel.init()` with the configured token
3. Starts session management
4. Captures UTM parameters and ad click IDs
5. Sets user identity from cookies
6. Registers experiment super properties
7. Patches `mixpanel.track()` for session checking

### `ppLib.mixpanel.getMixpanelCookieData()`

Parse and return the Mixpanel cookie contents. Useful for debugging.

### `ppLib.mixpanel.getConfig()`

Returns the current configuration object.

---

## Session Management

The module implements custom session tracking on top of Mixpanel:

- **Session ID** — UUID v4 generated per session, registered as super property `session_id`
- **Timeout** — 30 minutes of inactivity (configurable via `sessionTimeout`)
- **Check on every event** — `mixpanel.track()` is monkey-patched to call `session.check()` before each event
- **Session start event** — Fires a `Session Start` event when a new session begins

### How It Works

1. On `init()`, checks if a session exists in `sessionStorage`
2. If no session or session has expired, creates a new one with a fresh UUID
3. Registers `session_id` as a Mixpanel super property (included in all subsequent events)
4. Every call to `mixpanel.track()` first checks session validity

---

## UTM Attribution

The module tracks UTM parameters and ad platform click IDs:

### Tracked Parameters

| Type | Parameters |
|---|---|
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` |
| Google Ads | `gclid` |
| Facebook Ads | `fbclid` |

### Attribution Model

- **First touch** — Stored on the user's first visit. Never overwritten. Uses `localStorage` for persistence.
- **Last touch** — Updated on every visit with new tracking parameters. Uses `sessionStorage`.

Both are registered as Mixpanel super properties with `first_` and `last_` prefixes:

```javascript
// Registered as super properties:
{
  first_utm_source: 'google',
  first_utm_medium: 'cpc',
  last_utm_source: 'email',
  last_utm_campaign: 'promo'
}
```

---

## Identity

The module identifies users via cookies:

```javascript
// If userId cookie exists:
mixpanel.identify(userId);

// If ipAddress cookie exists:
mixpanel.register({ ip_address: ipAddress });
```

---

## Experiments

If an experiment cookie (default: `exp`) contains JSON data, the module parses it and registers experiment assignments as Mixpanel super properties:

```javascript
// Cookie value: {"variant_a":"control","variant_b":"treatment"}
// Registered as super properties:
{
  variant_a: 'control',
  variant_b: 'treatment'
}
```

---

## Dependencies

- **common** (`window.ppLib`) — getCookie, Storage, Security (sanitize), logging
- **Mixpanel CDN** — SDK loaded dynamically at runtime
