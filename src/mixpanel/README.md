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
  crossSubdomainCookie: false,        // Enable cross-subdomain tracking
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
mixpanel.register({ pp_user_id: userId });

// If ipAddress cookie exists:
mixpanel.register({ pp_user_ip: ipAddress });
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

## Architecture & Design Decisions

### Embedded SDK Snippet

The Mixpanel SDK loader is an embedded minified snippet (~70 lines) copied from Mixpanel's official documentation:

```typescript
var a = (win as any).mixpanel || [];
if (!a.__SV) {
  // ... Mixpanel stub creation and CDN script injection
  a.__SV = 1.2;
  b = doc.createElement('script');
  b.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
}
```

**Why:** This is Mixpanel's recommended integration pattern. The snippet creates method stubs (queuing calls before the SDK loads) and injects the CDN script. This allows immediate `mixpanel.track()` calls that are replayed after the SDK finishes loading.

**Tradeoff:** The snippet is opaque and hard to audit. Mixpanel SDK version updates require re-copying from Mixpanel docs. The CDN URL (`mixpanel-2-latest.min.js`) always loads the latest version, which is convenient but means the exact SDK version isn't pinned.

### Monkey-Patching `mixpanel.track()`

After SDK initialization, the module wraps `mixpanel.track()`:

```typescript
const originalTrack = mp.track;
mp.track = function() {
  SessionManager.check();
  mp.register({ 'last event time': Date.now() });
  originalTrack.apply(mp, arguments);
};
```

**Why:** Ensures session validity is checked on every tracking call. If the session has expired (>30 min since last event), a new session ID is generated before the event is tracked. This provides custom session management independent of Mixpanel's built-in sessions.

**Tradeoff:** Monkey-patching is fragile — if Mixpanel changes their `track()` signature or if another script also patches it, behavior could be unexpected. The `originalTrack.apply()` pattern preserves the original implementation.

### Custom Session Management

The module implements its own session system on top of Mixpanel:

- **UUID session IDs** via `Math.random()` hex generation (8-4-4-4-12 format)
- **30-minute rolling timeout** stored as Mixpanel super property `last event time`
- **Session ID** registered as super property `session ID` (included in all events)

**Why:** Mixpanel's built-in session tracking didn't meet PocketPills' requirements for cross-platform session correlation and custom timeout values. The SDK-managed sessions can be correlated with server-side analytics.

**Tradeoff:** `Math.random()` provides ~52 bits of entropy for session IDs. This is sufficient for analytics deduplication but not cryptographically secure. For security-sensitive session tokens, `crypto.getRandomValues()` should be used instead.

### UTM Attribution Parallel to Analytics Module

Both the analytics and mixpanel modules independently track UTM parameters:

| Module | Mechanism | Storage |
|---|---|---|
| Analytics | `UrlParser.getParams()` → `ppLib.Storage` | sessionStorage / localStorage |
| Mixpanel | `campaignParams()` → `mixpanel.register()` | Mixpanel super properties |

**Why:** The mixpanel module tracks UTM params as Mixpanel super properties (persisted in Mixpanel's cookie), while analytics stores them in the browser for cross-platform use. Each module needs its own copy because they serve different downstream systems.

**Tradeoff:** UTM extraction logic is duplicated. A shared utility in common would reduce duplication, but it would create a dependency on analytics' parameter configuration for the mixpanel module, violating module independence.

### `api_transport: 'sendBeacon'`

The Mixpanel SDK is configured with `sendBeacon` transport:

```typescript
mixpanel.init(CONFIG.token, { api_transport: 'sendBeacon', ... });
```

**Why:** `navigator.sendBeacon()` is designed for analytics — it guarantees delivery even when the page is unloading (tab close, navigation). Standard `XMLHttpRequest` or `fetch` calls may be aborted during page teardown.

**Tradeoff:** `sendBeacon` doesn't support response reading (fire-and-forget). This is fine for analytics where delivery confirmation isn't needed.

---

## Validation & Fallbacks

The Mixpanel module validates configuration and cookie data before SDK initialization.

### Configuration Validation

| Condition | Warning Logged | Behavior |
|---|---|---|
| `token` is empty/not set | `'No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.'` (warn) | `init()` returns early, SDK not loaded |
| `projectName` is empty | No warning | `project` super property not registered |
| `sessionTimeout` is `0` or negative | No warning | Sessions always expire immediately on next check |

### Cookie Validation Fallbacks

| Cookie | Validation | Fallback |
|---|---|---|
| `userId` (default: `'userId'`) | Must be non-empty after `getCookie()` | `pp_user_id` super property not registered |
| `ipAddress` (default: `'ipAddress'`) | Must be non-empty after `getCookie()` | `pp_user_ip` super property not registered |
| `experiments` (default: `'exp'`) | Must be valid JSON | `'Experiment cookie parse error'` logged (error), experiments skipped |

### Session Management Fallbacks

| Condition | Behavior |
|---|---|
| No `last event time` property in Mixpanel | New session ID generated |
| No `session ID` property in Mixpanel | New session ID generated |
| `last event time` exceeds `sessionTimeout` | New session ID generated, UTM params reset to `$direct` |
| Session ID generation | UUID v4 format via `Math.random()` hex (not cryptographically secure) |

### UTM Attribution Fallbacks

| Condition | Behavior |
|---|---|
| No UTM params in URL | No UTM properties registered; existing properties preserved |
| UTM param present but empty value | Registered as empty string (`''`) |
| `gclid` param not present | `gclid` property not registered |
| `fbclid` param not present | `fbclid` property not registered |
| Session expired | UTM last-touch params reset to `$direct` before new capture |

### Mixpanel Cookie Reader Fallbacks

| Condition | Behavior |
|---|---|
| No Mixpanel cookie found | Returns empty object `{}` |
| Cookie value is invalid JSON | `'getMixpanelCookieData error'` logged (error), returns `{}` |
| Multiple Mixpanel cookies | Last one found wins (overwrites `mixpanelData`) |

### SDK Loader Fallbacks

| Condition | Behavior |
|---|---|
| Mixpanel SDK already loaded (`__SV` exists) | Skips re-loading, uses existing instance |
| CDN script fails to load | SDK stub remains; `mixpanel.track()` calls are queued but never replayed |
| `api_transport: 'sendBeacon'` not available | Mixpanel SDK internally falls back to XHR |

---

## Known Limitations

1. **Single Mixpanel instance** — The module doesn't support multiple Mixpanel projects on the same page. Only one token can be configured.

2. **No consent gating** — Unlike braze and voucherify, the mixpanel module doesn't check `ppAnalytics.consent.status()` before loading the SDK. The `optOutByDefault` flag defers to Mixpanel's built-in opt-out, but the SDK is always loaded regardless.

3. **Experiment cookie format is undocumented** — The module expects a JSON cookie at the configured `experiments` key name. The schema of the JSON is not validated — all key-value pairs are registered as super properties.

4. **CDN dependency at runtime** — The Mixpanel SDK is loaded from `cdn.mxpnl.com`. If the CDN is blocked (ad blockers, corporate firewalls), the SDK never loads and all tracking silently fails. The analytics module's Mixpanel platform handles this gracefully (retry with timeout), but the mixpanel module's features (sessions, UTM, experiments) are completely lost.

---

## Dependencies

- **common** (`window.ppLib`) — getCookie, getQueryParam, extend, logging
- **Mixpanel CDN** (`cdn.mxpnl.com`) — SDK loaded dynamically at runtime
