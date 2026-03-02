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

## Dependencies

- **common** (`window.ppLib`) — SafeUtils, Security, Storage, logging

## Dependents

None — standalone analytics module. Other modules (ecommerce, event-source) push events to GTM/Mixpanel independently.
