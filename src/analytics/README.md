# Analytics Module

Multi-platform attribution tracking, consent management, and event dispatching. Automatically captures UTM parameters, ad platform click IDs, and referrer data on every page load.

**Output:** `analytics.min.js` | **Global:** `window.ppAnalytics` | **Version:** 3.1.0

---

## Overview

The analytics module tracks how users arrive at PocketPills web properties and distributes attribution data across multiple analytics platforms. It operates automatically on page load — no manual JavaScript calls required for basic attribution tracking.

**Core capabilities:**

1. **URL parameter capture** — UTM params, ad platform click IDs (gclid, fbclid, msclkid, etc.), custom params
2. **First/last touch attribution** — Persistent storage of initial and most recent traffic sources
3. **Session management** — 30-minute rolling sessions with automatic expiry
4. **Consent management** — OneTrust, CookieYes, and custom consent framework integration
5. **Multi-platform dispatch** — GTM (dataLayer), GA4, Mixpanel, and custom platform handlers
6. **Event queue** — Rate-limited, async event processing via `requestIdleCallback`

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Single-file module — config, consent, URL parsing, sessions, event queue, platforms, tracker |

This module is a single large IIFE containing all internal sub-systems as closure-scoped objects.

---

## Quick Start

```html
<script src="common.min.js"></script>
<script src="analytics.min.js"></script>
<!-- Attribution tracking starts automatically on page load -->
```

No configuration is required for basic UTM and attribution tracking. The module auto-initializes on `DOMContentLoaded`.

---

## Configuration

```javascript
ppAnalytics.config({
  consent: {
    required: true,
    defaultState: 'pending',    // 'approved' | 'pending' | 'denied'
    frameworks: {
      oneTrust: { enabled: true, cookieName: 'OptanonConsent', categoryId: 'C0002' },
      cookieYes: { enabled: true, cookieName: 'cookieyes-consent', categoryId: 'analytics' }
    }
  },

  parameters: {
    utm: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    ads: {
      google: ['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid'],
      facebook: ['fbclid', 'fb_action_ids'],
      microsoft: ['msclkid'],
      tiktok: ['ttclid'],
      linkedin: ['li_fat_id'],
      twitter: ['twclid'],
      pinterest: ['epik'],
      snapchat: ['ScCid']
    },
    custom: ['ref', 'referrer', 'promo', 'affiliate_id']
  },

  attribution: {
    sessionTimeout: 30,          // minutes
    enableFirstTouch: true,
    enableLastTouch: true,
    persistAcrossSessions: false,
    trackPageViews: true,
    autoCapture: true
  },

  platforms: {
    gtm: {
      enabled: true,
      events: {
        firstTouch: 'first_touch_attribution',
        lastTouch: 'last_touch_attribution',
        pageView: 'attribution_page_view'
      },
      rateLimitMax: 100,
      rateLimitWindow: 60000     // ms
    },
    ga4: { enabled: true, measurementId: null, sendPageView: true },
    mixpanel: { enabled: true, trackPageView: true, maxRetries: 50, retryInterval: 100 }
  },

  performance: {
    useRequestIdleCallback: true,
    queueEnabled: true,
    maxQueueSize: 50
  }
});
```

All options have sensible defaults — override only what you need.

---

## API Reference

### `ppAnalytics.config(options?)`

Configure module settings. Accepts `Partial<AnalyticsConfig>`. When called without arguments, returns the current config.

### `ppAnalytics.track(eventName, properties?)`

Track a custom event across all enabled platforms.

```javascript
ppAnalytics.track('button_clicked', {
  button_id: 'hero-cta',
  page: '/pricing'
});
```

Events are queued and dispatched asynchronously via the event queue system.

### `ppAnalytics.getAttribution()`

Returns the current first-touch and last-touch attribution data.

```javascript
var data = ppAnalytics.getAttribution();
// {
//   first_touch: { utm_source: 'google', utm_medium: 'cpc', ... },
//   last_touch:  { utm_source: 'email', utm_campaign: 'promo', ... },
//   session_start: '2024-01-15T10:30:00.000Z'
// }
```

### `ppAnalytics.consent`

Consent management for privacy compliance.

```javascript
ppAnalytics.consent.grant();   // Allow tracking
ppAnalytics.consent.revoke();  // Stop tracking, clear stored data
ppAnalytics.consent.status();  // 'approved' | 'pending' | 'denied'
```

When consent is revoked, the module stops capturing parameters and clears stored attribution data.

### `ppAnalytics.registerPlatform(name, handler)`

Register a custom analytics platform for event dispatch.

```javascript
ppAnalytics.registerPlatform('amplitude', function(eventName, properties) {
  amplitude.track(eventName, properties);
});
```

### `ppAnalytics.clear()`

Clear all stored attribution data (first_touch, last_touch, session_start).

### `ppAnalytics.init()`

Manually re-initialize the tracker. Normally called automatically on `DOMContentLoaded`.

---

## Internal Architecture

### URL Parameter Capture

On page load, the module extracts whitelisted parameters from `window.location.href`:

- **UTM parameters**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- **Ad platform IDs**: `gclid` (Google), `fbclid` (Facebook), `msclkid` (Microsoft), `ttclid` (TikTok), `li_fat_id` (LinkedIn), `twclid` (Twitter), `epik` (Pinterest), `ScCid` (Snapchat)
- **Custom**: `ref`, `referrer`, `promo`, `affiliate_id`

Parameters are validated against a whitelist (`isValidParam()`) before being stored.

### Attribution Logic

1. **First touch** — Stored on the user's very first visit. Never overwritten once set. Persisted in `localStorage`.
2. **Last touch** — Updated on every visit that has new tracking parameters. Stored in `sessionStorage` (or `localStorage` if `persistAcrossSessions` is enabled).
3. **Referrer classification** — `direct` (no referrer), `internal` (same hostname), `external` (different hostname).

### Session Management

- Sessions last 30 minutes (configurable via `attribution.sessionTimeout`)
- A new session starts when the timeout expires or no previous session exists
- Session start timestamp is stored in `sessionStorage`

### Event Queue

Events are processed asynchronously to avoid blocking the main thread:

- Queued events are processed via `requestIdleCallback` (or `setTimeout` fallback)
- Per-platform rate limiting prevents API overload (default: 100 events per 60s for GTM)
- Queue has a max size (default: 50) — oldest events are dropped when full
- FIFO processing order

### Platform Dispatch

Events are distributed to all enabled platforms:

| Platform | Destination | Event Format |
|---|---|---|
| GTM | `window.dataLayer.push()` | `{ event: eventName, ...properties }` |
| Mixpanel | `window.mixpanel.track()` | `(eventName, properties)` with retry logic |
| GA4 | `window.gtag()` | `('event', eventName, properties)` |
| Custom | User-registered handler | `handler(eventName, properties)` |

---

## Architecture & Design Decisions

### Single-File Module

Unlike other modules (braze=7 files, voucherify=5 files, login=4 files), analytics is a single 1094-line file with 8 internal closure-scoped objects (Utils, Consent, UrlParser, Session, EventQueue, Platforms, Tracker, API).

**Why:** The analytics module was the first complex module built and predates the multi-file decomposition pattern adopted later. The internal modules are tightly coupled (Tracker depends on Consent, EventQueue, Platforms, UrlParser, Session, and Storage) making extraction non-trivial.

**Tradeoff:** Harder to navigate and test individual sub-systems in isolation. A future refactor could extract Consent, EventQueue, and Platforms into separate files following the braze/voucherify pattern.

### Event Queue with `requestIdleCallback`

Events are queued and processed during browser idle time:

```typescript
if (typeof win.requestIdleCallback === 'function') {
  requestIdleCallback(() => self.processQueue(), { timeout: 2000 });
} else {
  setTimeout(() => self.processQueue(), 0);
}
```

**Why:** Analytics events are non-critical for page rendering. Processing them during idle time avoids blocking the main thread, especially important on mobile where CPU is limited.

**Tradeoff:** Events may be delayed by up to 2 seconds under heavy load. The 2s timeout ensures they're eventually processed even if the browser never goes idle.

### Rate Limiting

GTM events are rate-limited to 100 events per 60-second window:

```typescript
platforms: {
  gtm: { rateLimitMax: 100, rateLimitWindow: 60000 }
}
```

**Why:** Prevents accidental event floods from runaway code or rapid page navigation from overwhelming GTM/GA4 quotas.

**Tradeoff:** Legitimate high-frequency events could be dropped. The limit is configurable.

### Consent Storage Outside `ppLib.Storage`

The consent module uses raw `localStorage` directly instead of `ppLib.Storage`:

```typescript
localStorage.setItem(storageKey, this.state);
```

**Why:** Intentional design. Consent state must survive `Storage.clear()` (which is called when consent is revoked). If consent were stored through `ppLib.Storage`, revoking consent would also clear the consent record itself — creating a loop where the user's preference is lost.

**Tradeoff:** Bypasses `ppLib.Storage` namespace prefixing and `Security.validateData()` checks. This is acceptable because consent is a simple string (`'approved'` or `'denied'`), and the operation is wrapped in try/catch for unavailable-localStorage scenarios.

### Mixpanel Retry Polling

The Mixpanel platform sub-module polls for `window.mixpanel` availability:

```typescript
const check = setInterval(function() {
  if (win.mixpanel && win.mixpanel.register) { ... }
}, retryInterval);  // 50 retries × 100ms = 5s max
```

**Why:** Mixpanel SDK may load asynchronously after analytics. Events are queued and replayed once the SDK is available.

**Tradeoff:** Creates a 5-second polling interval if Mixpanel never loads (e.g., ad blocker). The interval self-terminates after `maxRetries`, so it's bounded.

### First/Last Touch Attribution Model

- **First touch** — Stored once, never overwritten. Represents original acquisition channel.
- **Last touch** — Updated on every visit with new tracking parameters. Represents most recent touchpoint.

**Why:** Marketing teams need both attribution models. First touch answers "how did we acquire this user?" and last touch answers "what brought them back?"

**Tradeoff:** First touch can become stale if stored in `sessionStorage` (default). Enable `persistAcrossSessions: true` to use `localStorage` for cross-session persistence.

---

## Validation & Fallbacks

The analytics module validates inputs at every stage of the pipeline and falls back to safe defaults when data is missing or invalid.

### Configuration Fallbacks

| Config Path | Default Value | Description |
|---|---|---|
| `consent.required` | `false` | Consent not required by default (tracking starts immediately) |
| `consent.defaultState` | `'approved'` | Default consent state when no framework is configured |
| `attribution.sessionTimeout` | `30` | Session timeout in minutes |
| `attribution.autoCapture` | `true` | Auto-capture URL params on page load |
| `attribution.enableFirstTouch` | `true` | Store first-touch attribution |
| `attribution.enableLastTouch` | `true` | Store last-touch attribution |
| `attribution.persistAcrossSessions` | `false` | Use sessionStorage (not localStorage) for first touch |
| `performance.maxQueueSize` | `50` | Max queued events before dropping |
| `performance.useRequestIdleCallback` | `true` | Use idle callback for async processing |
| `platforms.gtm.rateLimitMax` | `100` | Max GTM events per rate window |
| `platforms.gtm.rateLimitWindow` | `60000` | Rate limit window in ms |
| `platforms.mixpanel.maxRetries` | `50` | Max SDK availability retries |
| `platforms.mixpanel.retryInterval` | `100` | Retry interval in ms |

### URL Parsing Validations

| Input | Validation | Fallback |
|---|---|---|
| `window.location.href` | Validated via `Security.isValidUrl()` | Returns empty params `{}` |
| URL parameters | Only whitelisted params extracted | Non-whitelisted params are ignored |
| Parameter values | Sanitized via `Security.sanitize()` | Empty/invalid values skipped |

### Attribution Fallbacks

| Condition | Behavior |
|---|---|
| No tracking params in URL | `getTrackedParams()` returns `null`, no attribution stored |
| No referrer present | `getReferrer()` returns `'direct'` |
| Referrer is same hostname | `getReferrer()` returns `'internal'` |
| Referrer URL parse fails | Returns `'unknown'` (or `'direct'` if no referrer at all) |
| No first-touch stored | New first-touch is created with current params |
| Session expired or missing | New session starts, new first-touch allowed |
| `utm_source` missing from stored data | Defaults to `'direct'` in GTM/Mixpanel dispatch |
| `utm_medium` missing from stored data | Defaults to `'none'` in GTM/Mixpanel dispatch |

### Event Queue Validations

| Condition | Warning/Error Logged |
|---|---|
| Queue full (>= `maxQueueSize`) | `'Event queue full, dropping event'` (warn) |
| Event object null or not an object | Silently ignored |
| Event type null or empty | Silently ignored |
| GTM rate limit exceeded | `'Rate limit exceeded for gtm'` (warn) |

### Platform Dispatch Validations

| Platform | Validation | Warning/Error Logged |
|---|---|---|
| GTM | Data validated via `Security.validateData()` | `'Invalid GTM data rejected'` (error) |
| Mixpanel | Data validated via `Security.validateData()` | `'Invalid Mixpanel data rejected'` (error) |
| Mixpanel | SDK not available | Queued and retried (up to 50 attempts) |
| Mixpanel | SDK never loads | `'Mixpanel not available'` (verbose) after max retries |
| Custom | Handler must be a function | Silently ignored if not |

### Consent Validations

| Condition | Behavior |
|---|---|
| `consent.required` is `false` | Always returns `true` (granted) |
| Custom consent function throws | Error logged, returns `false` |
| OneTrust groups string missing | Falls back to stored consent |
| CookieYes cookie parse fails | Falls back to stored consent |
| localStorage unavailable | Falls back to default state |
| Consent revoked | `Storage.clear()` called to purge attribution data |

### Public API Validations

| Method | Validation | Warning/Error Logged |
|---|---|---|
| `track(eventName)` | `eventName` must not be empty | `'Event name required'` (error) |
| `track()` when not initialized | Tracker continues (queues event) | `'Tracker not initialized, queuing event'` (warn) |
| `registerPlatform(name, handler)` | Name must exist, handler must be a function | `'registerPlatform requires a valid name and handler function'` (warn) |

---

## Known Limitations

1. **Monolithic file** — Single-file architecture is harder to navigate than multi-file modules. Internal sub-systems are only testable through the IIFE boundary.

2. **No deduplication across page reloads** — If a user refreshes a page with UTM params, last-touch attribution is re-captured. This is by design (every pageview is a new "touch") but can over-count in SPA scenarios.

3. **Consent state not synced with CMP** — The module reads from OneTrust/CookieYes on every `isGranted()` call but doesn't listen for real-time consent changes. If a user changes consent preferences in the CMP modal, the analytics module won't pick up the change until the next page load.

4. **`sendAttribution()` field mapping is verbose** — The first/last touch GTM event construction manually maps 10+ fields per touch type. This is intentional for readability but could be DRYer with a loop.

---

## Dependencies

- **common** (`window.ppLib`) — SafeUtils, Security, Storage, logging

## Dependents

- **braze** and **voucherify** modules query `ppAnalytics.consent.status()` for consent gating
- Other modules (ecommerce, event-source) push events to GTM/Mixpanel independently
