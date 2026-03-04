# Voucherify Module

Readonly pricing integration for PocketPills web properties. Fetches promotional pricing from Voucherify's qualification API and injects discounted prices into the DOM via data attributes — no JavaScript required after setup.

**Output:** `voucherify.min.js` | **Global:** `ppLib.voucherify`

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Source Files](#source-files)
3. [Configuration Reference](#configuration-reference)
4. [HTML Data Attributes](#html-data-attributes)
5. [Pricing Flow](#pricing-flow)
6. [Voucher Validation](#voucher-validation)
7. [Qualification Checks](#qualification-checks)
8. [Caching](#caching)
9. [Backend Proxy Mode](#backend-proxy-mode)
10. [Consent Management](#consent-management)
11. [Programmatic API](#programmatic-api)
12. [Architecture](#architecture)
13. [Design Decisions & Tradeoffs](#design-decisions--tradeoffs)

---

## Quick Start

Add the scripts and configure. Price injection is automatic.

```html
<script src="/common.min.js"></script>
<script src="/voucherify.min.js"></script>
<script>
  ppLib.voucherify.configure({
    api: {
      applicationId: 'YOUR_APPLICATION_ID',
      clientSecretKey: 'YOUR_CLIENT_KEY',
      baseUrl: 'https://as1.api.voucherify.io'
    }
  });
  ppLib.voucherify.init();
</script>

<!-- Pricing auto-injected on page load -->
<div data-voucherify-product="weight-loss"
     data-voucherify-base-price="60">
  <span data-voucherify-original-price></span>
  <span data-voucherify-discounted-price></span>
  <span data-voucherify-discount-label></span>
</div>
```

The `applicationId` and `clientSecretKey` are **publishable client-side keys** from Voucherify (Project Settings > Application Keys). They are safe to include in HTML — they can only read qualifications and validate vouchers, never redeem or modify campaigns.

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Main entry point — IIFE wrapper, public API, consent check, auto-init |
| `config.ts` | Default configuration factory |
| `api-client.ts` | HTTP client with in-memory cache and backend proxy routing |
| `context.ts` | Request context builder — customer from cookies, UTM params, DOM scanning |
| `pricing.ts` | Pricing engine — qualification-to-price mapping, `Intl.NumberFormat`, DOM injection |

---

## Configuration Reference

All options are passed via `ppLib.voucherify.configure({ ... })` before calling `init()`. Every option has a sensible default — only `api.applicationId` and `api.clientSecretKey` are required (unless using [backend proxy mode](#backend-proxy-mode)).

### `api` — Voucherify API Settings

| Option | Type | Default | Description |
|---|---|---|---|
| `applicationId` | `string` | `''` | **Required.** Voucherify Application ID (publishable). |
| `clientSecretKey` | `string` | `''` | **Required.** Voucherify Client Secret Key (publishable, safe for browser). |
| `baseUrl` | `string` | `'https://as1.api.voucherify.io'` | Voucherify API cluster URL. Change for EU (`https://eu1.api.voucherify.io`). |
| `origin` | `string` | `''` | Origin header override. Auto-detected from `window.location.origin` if empty. |

### `cache` — Caching & Backend Proxy

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | `false` = direct Voucherify API. `true` = route through backend proxy. |
| `baseUrl` | `string` | `'/api/voucherify'` | Backend proxy URL path (used when `enabled: true`). |
| `ttl` | `number` | `300000` | Client-side in-memory cache TTL in milliseconds (5 min default). |

### `pricing` — Price Display

| Option | Type | Default | Description |
|---|---|---|---|
| `autoFetch` | `boolean` | `true` | Automatically fetch pricing on `DOMContentLoaded`. |
| `productAttribute` | `string` | `'data-voucherify-product'` | Attribute identifying product containers. |
| `priceAttribute` | `string` | `'data-voucherify-base-price'` | Attribute containing the base price (source). |
| `originalPriceAttribute` | `string` | `'data-voucherify-original-price'` | Injection target for original (strikethrough) price. |
| `discountedPriceAttribute` | `string` | `'data-voucherify-discounted-price'` | Injection target for discounted price. |
| `discountLabelAttribute` | `string` | `'data-voucherify-discount-label'` | Injection target for discount badge (e.g., "25% OFF"). |
| `currencySymbol` | `string` | `'$'` | Fallback currency symbol (used if `Intl.NumberFormat` unavailable). |
| `currency` | `string` | `'CAD'` | ISO 4217 currency code for formatting. |
| `locale` | `string` | `'en-CA'` | BCP 47 locale for `Intl.NumberFormat`. |

### `context` — Request Context

| Option | Type | Default | Description |
|---|---|---|---|
| `customerSourceIdCookie` | `string` | `'userId'` | Cookie name containing the customer's external ID. |
| `includeUtmParams` | `boolean` | `true` | Include `utm_source`, `utm_medium`, `utm_campaign` in customer metadata. |
| `includeLoginState` | `boolean` | `true` | Include `is_logged_in` flag in customer metadata. |

### `consent` — Consent Gating

| Option | Type | Default | Description |
|---|---|---|---|
| `required` | `boolean` | `false` | If `true`, module won't initialize until consent is granted. |
| `mode` | `'analytics' \| 'custom'` | `'analytics'` | `analytics` reads from `ppAnalytics.consent.status()`. `custom` uses `checkFunction`. |
| `checkFunction` | `() => boolean` | `() => true` | Custom consent check function (used when `mode: 'custom'`). |

---

## HTML Data Attributes

### Product Container

Mark any element as a product with its base price:

```html
<div data-voucherify-product="weight-loss"
     data-voucherify-base-price="60">
  <!-- Price injection targets go inside -->
</div>
```

| Attribute | Required | Description |
|---|---|---|
| `data-voucherify-product` | Yes | Unique product ID (sent to Voucherify as `source_id`). |
| `data-voucherify-base-price` | Yes | Base price as a number (e.g., `"60"`, `"29.99"`). |

### Injection Targets

Place these elements inside the product container. The SDK fills them automatically after fetching pricing.

```html
<span data-voucherify-original-price></span>     <!-- "$60.00" -->
<span data-voucherify-discounted-price></span>    <!-- "$45.00" -->
<span data-voucherify-discount-label></span>      <!-- "25% OFF" -->
```

| Attribute | Injected Value | When No Discount |
|---|---|---|
| `data-voucherify-original-price` | Base price formatted (e.g., `$60.00`) | `$60.00` |
| `data-voucherify-discounted-price` | Discounted price or base price if no discount | `$60.00` |
| `data-voucherify-discount-label` | Discount badge (e.g., `25% OFF`, `$10.00 OFF`) | Empty string |

### Full Page Example

```html
<div data-voucherify-product="weight-loss"
     data-voucherify-base-price="60">
  <h3>Weight Loss Assessment</h3>
  <p>
    <s><span data-voucherify-original-price></span></s>
    <strong><span data-voucherify-discounted-price></span></strong>
  </p>
  <span class="badge" data-voucherify-discount-label></span>
</div>

<div data-voucherify-product="hair-loss"
     data-voucherify-base-price="30">
  <h3>Hair Loss Treatment</h3>
  <p>
    <s><span data-voucherify-original-price></span></s>
    <strong><span data-voucherify-discounted-price></span></strong>
  </p>
  <span class="badge" data-voucherify-discount-label></span>
</div>
```

Style the `<s>` tag with CSS for strikethrough effect. Hide the discount label badge when empty using CSS:

```css
[data-voucherify-discount-label]:empty {
  display: none;
}
```

---

## Pricing Flow

### Automatic (default)

When `pricing.autoFetch` is `true` (default), the SDK:

1. Waits for `DOMContentLoaded`
2. Scans the DOM for `[data-voucherify-product]` elements
3. Reads base prices from `data-voucherify-base-price`
4. Builds customer context from cookies and URL params
5. Calls Voucherify's `/client/v1/qualifications` API
6. Maps the best discount per product
7. Injects formatted prices into the DOM

### Manual

For SPAs or when you need control over timing:

```javascript
ppLib.voucherify.configure({
  pricing: { autoFetch: false }
});

// Fetch for all products on the page
const results = await ppLib.voucherify.fetchPricing();

// Fetch for specific products only
const results = await ppLib.voucherify.fetchPricing(['weight-loss', 'hair-loss']);
```

### PricingResult Object

Each product returns a `PricingResult`:

```javascript
{
  productId: 'weight-loss',
  basePrice: 60,
  discountedPrice: 45,
  discountAmount: 15,
  discountLabel: '25% OFF',
  discountType: 'PERCENT',     // 'PERCENT' | 'AMOUNT' | 'FIXED' | 'UNIT' | 'NONE'
  applicableVouchers: ['SUMMER25', 'VIP-DISCOUNT'],
  campaignName: 'Summer Sale 2026'
}
```

### Discount Types

| Type | Voucherify Field | Calculation | Label Example |
|---|---|---|---|
| `PERCENT` | `percent_off: 25` | `basePrice * 0.25` | `25% OFF` |
| `AMOUNT` | `amount_off: 1000` | `1000 / 100` (cents to dollars) | `$10.00 OFF` |
| `FIXED` | `fixed_amount: 4500` | `basePrice - (4500 / 100)` | `$15.00 OFF` |
| `UNIT` | `unit_off: 1` | `1 * basePrice` (free units) | (no label) |

When multiple discounts apply to a product, the SDK selects the **best (highest)** discount.

---

## Voucher Validation

Validate a specific voucher code before applying it:

```javascript
const result = await ppLib.voucherify.validateVoucher('SUMMER25');

if (result.valid) {
  console.log('Discount:', result.discount);
  console.log('Order total:', result.order.total_amount);
} else {
  console.log('Invalid:', result.reason);
}
```

### With Context

Pass customer and order context for accurate validation:

```javascript
const result = await ppLib.voucherify.validateVoucher('SUMMER25', {
  customer: { source_id: 'user-123' },
  order: { amount: 6000, items: [{ product_id: 'weight-loss', quantity: 1 }] }
});
```

### ValidationResult

```javascript
{
  valid: true,
  code: 'SUMMER25',
  discount: { type: 'PERCENT', percent_off: 25 },
  reason: undefined,  // set when valid: false (e.g., 'INAPPLICABLE')
  order: {
    amount: 6000,
    discount_amount: 1500,
    total_amount: 4500
  }
}
```

---

## Qualification Checks

Query all available promotions for a customer/order context:

```javascript
const result = await ppLib.voucherify.checkQualifications({
  scenario: 'ALL',
  customer: { source_id: 'user-123' },
  order: { items: [{ product_id: 'weight-loss', quantity: 1 }] }
});

console.log(`${result.total} applicable promotions`);
result.redeemables.forEach(r => {
  console.log(r.id, r.result?.discount);
});
```

### Scenarios

| Scenario | Description |
|---|---|
| `ALL` | All applicable vouchers, promotions, and campaigns |
| `CUSTOMER_WALLET` | Only vouchers assigned to the customer |
| `AUDIENCE_ONLY` | Promotions matching audience rules |
| `PRODUCTS` | Product-specific discounts |

---

## Caching

The SDK implements a **client-side in-memory cache** to prevent duplicate API calls during a page session.

```
fetchPricing('weight-loss')  →  API call  →  cache stores response
fetchPricing('weight-loss')  →  cache hit  →  no API call (returns cached data)
fetchPricing('hair-loss')    →  API call  →  different cache key
```

- **TTL:** 5 minutes (configurable via `cache.ttl`)
- **Key:** Derived from endpoint + serialized request body (deterministic)
- **Scope:** Per module instance (cleared on page reload)

### Manual Cache Control

```javascript
// Clear all cached responses
ppLib.voucherify.clearCache();

// Next fetch will hit the API again
await ppLib.voucherify.fetchPricing();
```

---

## Backend Proxy Mode

By default, the SDK calls Voucherify's client-side API directly from the browser. When a backend cache proxy is available, flip the `cache.enabled` flag to route all requests through your server.

### Direct Mode (default)

```
Browser  →  https://as1.api.voucherify.io/client/v1/qualifications
             (with publishable Application ID + Client Key headers)
```

### Backend Proxy Mode

```
Browser  →  /api/voucherify/qualifications  →  Your Backend  →  Voucherify API
             (no auth headers)                   (server-side keys + Redis cache)
```

### Switching

```javascript
ppLib.voucherify.configure({
  cache: {
    enabled: true,
    baseUrl: '/api/voucherify'
  }
  // api keys no longer needed — backend owns them
});
ppLib.voucherify.init();
```

### Advantages of Backend Proxy

| Concern | Direct Mode | Backend Proxy |
|---|---|---|
| **API keys** | Publishable keys in HTML | Server-side keys (truly secret) |
| **Rate limits** | Per-browser client | Server-managed, pooled |
| **Caching** | In-memory (per page session) | Redis/Memcached (shared across users) |
| **Response time** | Depends on Voucherify latency | Cached responses are instant |
| **Security** | Publishable keys are safe | Tighter control, audit logging |

### Backend Contract

The backend receives the same POST body the SDK would send to Voucherify. It should:

1. Forward the body to Voucherify's server-side API (with secret keys)
2. Cache the response in Redis/Memcached
3. Return the same response shape Voucherify returns

```
POST /api/voucherify/qualifications
Content-Type: application/json

{ "order": { "items": [...] }, "customer": { ... }, "scenario": "ALL" }
```

---

## Consent Management

The SDK supports consent gating — it won't initialize until consent is granted.

### Using ppAnalytics consent (default)

```javascript
ppLib.voucherify.configure({
  consent: {
    required: true,
    mode: 'analytics'  // reads ppAnalytics.consent.status()
  }
});
```

### Using a custom consent function

```javascript
ppLib.voucherify.configure({
  consent: {
    required: true,
    mode: 'custom',
    checkFunction: function() {
      return document.cookie.includes('consent=accepted');
    }
  }
});
```

If consent is not granted when `init()` is called, the module logs a message and does not fetch pricing.

---

## Programmatic API

| Method | Returns | Description |
|---|---|---|
| `configure(options?)` | `VoucherifyConfig` | Merge configuration. Call before `init()`. |
| `init()` | `void` | Check consent and auto-fetch pricing (if `autoFetch: true`). |
| `fetchPricing(productIds?)` | `Promise<PricingResult[]>` | Fetch pricing for all/specific products. Injects into DOM. |
| `validateVoucher(code, context?)` | `Promise<ValidationResult>` | Validate a specific voucher code. |
| `checkQualifications(context?)` | `Promise<QualificationResult>` | Query all applicable promotions. |
| `clearCache()` | `void` | Clear the in-memory response cache. |
| `isReady()` | `boolean` | Always returns `true` (no CDN SDK to load). |
| `getConfig()` | `VoucherifyConfig` | Returns the current configuration object. |

---

## Architecture

### Data Flow

```
HTML Element (data-voucherify-*)
  → DOM scan (context.ts: getProductsFromDOM)
    → Build request context (context.ts: buildCustomer, buildOrderItems)
      → API call (api-client.ts: qualifications)
        → Map response to PricingResult[] (pricing.ts: mapQualificationsToResults)
          → Inject into DOM (pricing.ts: injectPricing)
```

### Module Dependency Graph

```
index.ts (orchestrator)
  ├── config.ts          → VoucherifyConfig factory
  ├── api-client.ts      → HTTP + cache layer
  │     └── CONFIG.cache.enabled → direct vs proxy routing
  ├── context.ts         → DOM scanning + customer context
  │     └── ppLib.getCookie, ppLib.Security.sanitize, ppLib.login
  └── pricing.ts         → Price resolution + DOM injection
        └── api-client, context (injected via factory params)
```

### Key Patterns

1. **Factory functions** — All sub-modules are factory functions (not classes). Dependencies are injected via closure parameters, avoiding `this` binding issues.

2. **IIFE wrapping** — The entry point is an IIFE `(function(win, doc) { ... })(window, document)` that prevents global namespace pollution.

3. **Safe load queue** — The module registers itself via `ppLibReady` if `ppLib` isn't available yet, allowing any script load order after `common.min.js`.

4. **In-memory Map cache** — API responses are cached with TTL-based expiry. Cache key is `endpoint + ':' + JSON.stringify(body)` for deterministic lookups.

5. **No CDN SDK** — Unlike Braze (which loads a 50KB SDK from CDN), Voucherify's client-side API is pure REST. The module uses `fetch()` directly, making `isReady()` always `true`.

---

## Design Decisions & Tradeoffs

### 1. Direct API vs Backend Proxy (configurable)

**Decision:** Support both modes with a single `cache.enabled` toggle.

| | Direct API | Backend Proxy |
|---|---|---|
| **Setup** | Zero backend work | Requires backend endpoint |
| **Latency** | Browser → Voucherify (higher) | Browser → your CDN (lower) |
| **Keys** | Publishable keys in HTML | Server-side secret keys |
| **Cache** | Per-browser, 5 min TTL | Shared Redis, configurable TTL |

**Why both:** Direct mode enables immediate development without backend dependencies. Backend proxy mode is the production target for performance and security.

### 2. Best-Discount Selection

**Decision:** When multiple promotions apply to a product, select the one with the highest absolute discount amount.

**Tradeoff:** This is a simple greedy algorithm. It doesn't consider stacking rules, minimum order amounts, or customer preferences. Voucherify's server-side redemption API handles those complexities — this module is readonly and shows the best possible price.

### 3. `Intl.NumberFormat` for Price Formatting

**Decision:** Use `Intl.NumberFormat` with locale and currency config, with a fallback to `currencySymbol + amount.toFixed(2)`.

**Advantage:** Correct locale-aware formatting ($60.00 in en-CA, 60,00 $ in fr-CA).

**Tradeoff:** The formatter is lazily created once and reused. If `configure()` changes the currency/locale after the first format call, the cached formatter becomes stale. This is acceptable because currency/locale are typically set once at initialization.

### 4. DOM Scanning for Product Discovery

**Decision:** Products are discovered by scanning `[data-voucherify-product]` elements, not via a JavaScript product list.

**Advantage:** Zero-JavaScript setup for marketing teams — add HTML attributes in Webflow, pricing appears automatically.

**Tradeoff:** Base prices must be in the DOM as `data-voucherify-base-price` attributes, which are visible in the page source. For public pricing this is fine. If prices are sensitive, use the backend proxy mode where the server can inject prices server-side.

### 5. No Retry Logic

**Decision:** Network failures fail silently (log error, return `[]`).

**Why:** This is a readonly pricing display. A failed fetch means prices don't update, but the page still renders with empty price slots. The 5-minute cache prevents hammering the API. Retry logic would add complexity for marginal benefit on a marketing page.

### 6. In-Memory Cache (Map, not localStorage)

**Decision:** Cache is a simple `Map` in memory, not persisted to `localStorage`.

**Advantage:** No serialization overhead, no storage quota concerns, no stale data across sessions.

**Tradeoff:** Cache is lost on page reload. Acceptable because pricing should be fresh per session, and the 5-minute TTL prevents excessive API calls within a session.

### 7. `validateVoucher` Inline in index.ts

**Decision:** Voucher validation is implemented inline in the public API rather than in a separate sub-module.

**Why:** It's a single API call with simple request/response mapping (not complex enough to warrant a separate file). The context builder and pricing engine are separate because they have multiple functions and DOM interaction.

---

## Validation & Fallbacks

The Voucherify module validates all inputs and handles API failures gracefully with safe defaults.

### Initialization Validation

| Condition | Warning Logged | Behavior |
|---|---|---|
| `api.applicationId` empty and `cache.enabled` is `false` | `'No applicationId configured and cache not enabled. Call ppLib.voucherify.configure() before init.'` (warn) | `init()` returns early |
| Consent not granted | `'Consent not granted -- module not initialized'` (info) | Module not initialized |
| Consent check throws | `'consent check error'` (error) | Returns `false` (denied) |

### API Client Validation

| Condition | Error Thrown/Logged | Fallback |
|---|---|---|
| `cache.enabled` is `true` but `cache.baseUrl` empty | `'Voucherify cache.baseUrl is not configured'` (thrown) | Caught by `fetchPricing()`, returns `[]` |
| Direct mode but `applicationId` or `clientSecretKey` missing | `'Voucherify API credentials missing: applicationId clientSecretKey'` (thrown) | Caught by `fetchPricing()`, returns `[]` |
| HTTP response not OK | `'Voucherify /endpoint: statusCode'` (thrown) | Caught by `fetchPricing()`, returns `[]` |
| Network failure (fetch throws) | `'fetchPricing error'` (error) | Returns `[]` |
| JSON stringify fails for cache key | Falls back to `endpoint + ':' + Date.now()` | Cache miss (always fetches) |

### DOM Scanning Validation

| Condition | Warning Logged | Behavior |
|---|---|---|
| Element has `data-voucherify-product` but value is empty after sanitization | `'Element with [...] has empty product ID -- skipped'` (warn) | Element excluded from pricing fetch |
| `data-voucherify-base-price` missing or non-numeric | No warning | Base price defaults to `0` |
| No `[data-voucherify-product]` elements on page | No warning | `fetchPricing()` returns `[]` |

### Context Building Fallbacks

| Condition | Behavior |
|---|---|
| `customerSourceIdCookie` cookie not found | Customer context not included in API request |
| `ppLib.login` not available | `is_logged_in` defaults to `false` |
| UTM params not in URL | UTM metadata not included |
| Customer source ID sanitized to empty | Customer context omitted |

### Pricing Engine Fallbacks

| Condition | Behavior |
|---|---|
| No redeemables in qualification response | All products get `discountType: 'NONE'`, price unchanged |
| Discount amount exceeds base price | Discounted price clamped to `0` via `Math.max(0, ...)` |
| `Intl.NumberFormat` not available | Falls back to `currencySymbol + amount.toFixed(2)` |
| Multiple discounts apply to same product | Highest absolute discount wins (greedy selection) |
| Discount type is unrecognized | `discountAmount` remains `0`, type is `'NONE'` |

### DOM Injection Fallbacks

| Condition | Behavior |
|---|---|
| `[data-voucherify-original-price]` not found | No injection (silent) |
| `[data-voucherify-discounted-price]` not found | No injection (silent) |
| `[data-voucherify-discount-label]` not found | No injection (silent) |
| No discount for product | Discounted price shows base price; discount label shows `''` |

### Voucher Validation Fallbacks

| Condition | Behavior |
|---|---|
| Voucher code empty after sanitization | Returns `{ valid: false, code, reason: 'Empty voucher code' }` |
| Validation API call fails | Returns `{ valid: false, code, reason: 'Validation error' }` |
| Redeemable status is not `'APPLICABLE'` | Returns `{ valid: false }` with status as `reason` |

### Cache Behavior

| Condition | Behavior |
|---|---|
| Cache entry exists and within TTL | Cached response returned (no API call) |
| Cache entry expired (past TTL) | New API call, cache updated |
| `clearCache()` called | All cached entries removed |
| Cache key generation fails | Unique key generated with `Date.now()` (effectively no cache for that request) |

---

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging, getCookie, getQueryParam, extend
- **login** (`ppLib.login`) — Optional; used for `is_logged_in` metadata when `context.includeLoginState: true`
- **analytics** (`window.ppAnalytics`) — Optional; used for consent status when `consent.mode: 'analytics'`

## Testing

```bash
# Unit tests (60 tests, 100% coverage)
pnpm test tests/voucherify/voucherify.test.ts

# All unit tests with coverage enforcement
pnpm run test:coverage

# E2e tests (mock API via Playwright route interception)
pnpm run test:e2e
```

See `tests/voucherify/voucherify.test.ts` for unit tests covering configuration, API routing, caching, context building, DOM scanning, all discount types, voucher validation, and error handling.

See `e2e/voucherify.spec.ts` for end-to-end tests covering SDK lifecycle, DOM injection, caching behavior, and backend proxy mode.
