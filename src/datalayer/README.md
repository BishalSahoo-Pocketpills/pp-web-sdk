# DataLayer Module

Unified GTM event system that pushes enriched events to `window.dataLayer` for distribution to GA4, Facebook CAPI, Reddit, and Mixpanel via GTM. Supports both programmatic API calls and declarative `data-dl-*` HTML attributes with automatic DOM binding.

**Output:** `datalayer.min.js` | **Global:** `ppLib.datalayer`

---

## Overview

The datalayer module provides two ways to push events:

1. **Programmatic API** — Call methods like `ppLib.datalayer.pageview()` or `ppLib.datalayer.addToCart(items)` from JavaScript
2. **Declarative DOM binding** — Add `data-dl-event` attributes to HTML elements for automatic event tracking on click/tap

Every event pushed includes:
- **user** — `pp_user_id`, `pp_patient_id`, `logged_in` (from cookies or manual override)
- **user_data** — SHA-256 hashed PII (email, phone, name, street) + plain text address fields
- **page** — `url`, `title`, `referrer`
- **pp_timestamp** — ISO 8601

The module auto-initializes DOM binding on `DOMContentLoaded` and auto-populates `user_data.address` from `firstName`/`lastName` cookies.

---

## Source Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point — IIFE wrapper, sub-module wiring, public API surface |
| `config.ts` | Configuration factory with defaults (cookies, attributes, debounce, navigation) |
| `user.ts` | User context builder — cookie-based auth state with manual overrides |
| `user-data.ts` | SHA-256 hashing of PII via Web Crypto API, cached user_data |
| `page.ts` | Page context builder — URL, title, referrer |
| `items.ts` | Item normalization and value calculation for ecommerce events |
| `events.ts` | Event enrichment and `window.dataLayer` push |
| `dom.ts` | DOM binding — event delegation, data attribute extraction, debounce, anchor hitCallback |

---

## Quick Start

### Programmatic

```html
<script src="common.min.js"></script>
<script src="datalayer.min.js"></script>
<script>
  ppLib.ready(function() {
    ppLib.datalayer.setUserData({
      email: 'user@example.com',
      city: 'Toronto',
      region: 'ON',
      country: 'CA'
    });
    ppLib.datalayer.pageview();
  });
</script>
```

### Declarative (Data Attributes)

```html
<script src="common.min.js"></script>
<script src="datalayer.min.js"></script>

<!-- Auto-tracked on click/tap — no JavaScript needed -->
<button data-dl-event="login_view" data-dl-method="email">
  Log In
</button>

<!-- Ecommerce item with container pattern -->
<section data-dl-item-id="RX-001" data-dl-item-name="Aspirin" data-dl-item-price="12.99">
  <button data-dl-event="add_to_cart">Add to Cart</button>
</section>

<!-- Anchor with hitCallback — intercepts navigation, pushes event, then navigates -->
<a href="/checkout" data-dl-event="begin_checkout"
   data-dl-item-id="RX-001" data-dl-item-name="Aspirin" data-dl-item-price="12.99">
  Proceed to Checkout
</a>
```

The module auto-initializes on `DOMContentLoaded`. No manual `init()` call needed.

---

## Configuration Reference

```javascript
ppLib.datalayer.configure({
  cookieNames: {
    userId: 'userId',                    // User ID cookie
    patientId: 'patientId',              // Patient ID cookie
    firstName: 'firstName',              // First name cookie (auto-hashed for user_data)
    lastName: 'lastName',                // Last name cookie (auto-hashed for user_data)
    appAuth: 'app_is_authenticated'      // App auth cookie (required for logged_in=true)
  },
  defaults: {
    itemBrand: 'Pocketpills',            // Default item_brand for ecommerce
    currency: 'CAD',                     // Default currency
    platform: 'web'                      // Platform value added to pageview events
  },
  attributes: {
    event: 'data-dl-event',              // Event name attribute
    method: 'data-dl-method',            // Auth method
    pageType: 'data-dl-page-type',       // Page type
    signupFlow: 'data-dl-signup-flow',   // Signup flow identifier
    searchTerm: 'data-dl-search-term',   // Search query
    resultsCount: 'data-dl-results-count', // Search results count
    searchType: 'data-dl-search-type',   // Search type
    itemId: 'data-dl-item-id',           // Ecommerce item ID
    itemName: 'data-dl-item-name',       // Ecommerce item name
    itemBrand: 'data-dl-item-brand',     // Ecommerce item brand
    itemCategory: 'data-dl-item-category', // Ecommerce item category
    price: 'data-dl-item-price',              // Ecommerce price
    quantity: 'data-dl-quantity',         // Ecommerce quantity
    discount: 'data-dl-discount',        // Ecommerce discount
    coupon: 'data-dl-coupon',            // Ecommerce coupon code
    currency: 'data-dl-currency',        // Ecommerce currency override
    transactionId: 'data-dl-transaction-id' // Purchase transaction ID
  },
  debounceMs: 300,                       // Debounce window for duplicate clicks (ms)
  navigationDelay: 100                   // Delay before anchor navigation (ms)
});
```

All options have sensible defaults — override only what you need.

---

## Data Attributes

### Core Events

| Attribute | Description |
|-----------|-------------|
| `data-dl-event` | **Required.** Event name (e.g., `pageview`, `login_view`, `search`) |
| `data-dl-method` | Auth method (for `login_view`, `login_success`, `signup_*` events) |
| `data-dl-page-type` | Page type classification |
| `data-dl-signup-flow` | Signup flow identifier |
| `data-dl-search-term` | Search query string |
| `data-dl-results-count` | Number of search results (parsed as integer) |
| `data-dl-search-type` | Type of search performed |

### Ecommerce Events

| Attribute | Description |
|-----------|-------------|
| `data-dl-item-id` | Product/item ID |
| `data-dl-item-name` | Product/item name |
| `data-dl-item-brand` | Brand (defaults to config `itemBrand`) |
| `data-dl-category` | Product category |
| `data-dl-item-price` | Price (string parsed to float) |
| `data-dl-quantity` | Quantity (string parsed to int, default: 1) |
| `data-dl-discount` | Discount amount (string parsed to float) |
| `data-dl-coupon` | Coupon code |
| `data-dl-currency` | Currency override |
| `data-dl-transaction-id` | Transaction ID (for `purchase` events only) |

### Ecommerce Event Names

These event names are routed to the ecommerce handler (with item data extraction):

`view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`

All other event names are routed to the core event handler.

### Item Resolution

When a `data-dl-event` element is clicked, item data is resolved in this order:

1. **Flat pattern** — Item attributes on the element itself
2. **Container pattern** — Nearest ancestor with `data-dl-item-id` or `data-dl-item-name`

```html
<!-- Flat: item data on the same element -->
<button data-dl-event="add_to_cart"
        data-dl-item-id="RX-001" data-dl-item-price="12.99">
  Add
</button>

<!-- Container: button inherits item data from parent -->
<section data-dl-item-id="RX-001" data-dl-item-name="Aspirin" data-dl-item-price="12.99">
  <button data-dl-event="add_to_cart">Add</button>
</section>
```

---

## API Reference

### Configuration

```js
ppLib.datalayer.configure({
  defaults: { currency: 'USD' }
});

ppLib.datalayer.getConfig(); // returns current config
```

### User Context

```js
// Manual override (takes precedence over cookies)
ppLib.datalayer.setUser({ pp_user_id: '123', logged_in: true });

// Raw PII — SDK hashes email, phone, name, street via SHA-256
await ppLib.datalayer.setUserData({
  email: 'user@example.com',
  phone: '+15551234567',
  first_name: 'John',
  last_name: 'Doe',
  street: '123 Main St',
  city: 'Toronto',
  region: 'ON',
  postal_code: 'M5V 1A1',
  country: 'CA'
});

// Pre-hashed — passed through directly
ppLib.datalayer.setUserDataHashed({
  sha256_email_address: '...64-char hex...',
  address: { sha256_first_name: '...', city: 'Toronto' }
});
```

### Core Events

```js
ppLib.datalayer.pageview({ page_type: 'home' });
ppLib.datalayer.loginView({ method: 'email' });
ppLib.datalayer.loginSuccess({ method: 'email', pp_user_id: '123' });
ppLib.datalayer.signupView({ method: 'email', signup_flow: 'onboarding' });
ppLib.datalayer.signupStart({ method: 'email' });
ppLib.datalayer.signupComplete({ method: 'email', pp_user_id: '123' });
ppLib.datalayer.search({ search_term: 'aspirin', results_count: 5 });
```

### Ecommerce Events

```js
const items = [
  { item_id: 'RX-001', item_name: 'Aspirin', price: 12.99, quantity: 2 }
];

ppLib.datalayer.viewItem(items);
ppLib.datalayer.addToCart(items);
ppLib.datalayer.beginCheckout(items);
ppLib.datalayer.addPaymentInfo(items);
ppLib.datalayer.purchase('TXN-001', items);
```

### Generic Push

```js
// Custom event
ppLib.datalayer.push('custom_event', { key: 'value' });

// Custom ecommerce event
ppLib.datalayer.pushEcommerce('remove_from_cart', items, { list_name: 'cart' });
```

### DOM Binding

```js
ppLib.datalayer.init();     // Manually re-initialize DOM listeners
ppLib.datalayer.bindDOM();  // Alias for init()
```

Both are called automatically on `DOMContentLoaded`.

---

## Event Output

### Standard Event

```javascript
window.dataLayer.push({
  event: 'pageview',
  user: {
    pp_user_id: '12345',
    pp_patient_id: '67890',
    logged_in: true
  },
  user_data: {
    sha256_email_address: 'abc123...64chars',
    sha256_phone_number: '',
    address: {
      sha256_first_name: 'def456...64chars',
      sha256_last_name: 'ghi789...64chars',
      sha256_street: '',
      city: 'Toronto',
      region: 'ON',
      postal_code: 'M5V 1A1',
      country: 'CA'
    }
  },
  page: {
    url: 'https://www.example.com/pricing',
    title: 'Pricing - PocketPills',
    referrer: 'https://www.google.com/'
  },
  pp_timestamp: '2024-01-15T10:30:00.000Z',
  platform: 'web'
});
```

### Ecommerce Event

```javascript
// First: null clear
window.dataLayer.push({ ecommerce: null });

// Then: enriched event
window.dataLayer.push({
  event: 'add_to_cart',
  ecommerce: {
    items: [{
      item_id: 'RX-001',
      item_name: 'Aspirin',
      item_brand: 'Pocketpills',
      item_category: null,
      price: 12.99,
      quantity: 2,
      discount: 0,
      coupon: null
    }],
    value: 25.98,
    currency: 'CAD'
  },
  user: { ... },
  user_data: { ... },
  page: { ... },
  pp_timestamp: '...'
});
```

---

## Item Normalization

Input items are flexible — missing fields default to `null`, `0`, or config defaults:

| Field | Default |
|-------|---------|
| `item_id` | `null` |
| `item_name` | `null` |
| `item_brand` | `'Pocketpills'` (config) |
| `item_category` | `null` |
| `price` | `0` (parses strings) |
| `quantity` | `1` |
| `discount` | `0` (parses strings) |
| `coupon` | `null` |

### Value Calculation

`value = Σ (price × quantity - discount)`, rounded to 2 decimal places.

---

## SHA-256 Hashing

- Uses Web Crypto API (`crypto.subtle.digest`)
- Input is lowercased and trimmed before hashing
- Pre-hashed values (matching `/^[a-f0-9]{64}$/i`) are passed through
- Cached after `setUserData()` / `setUserDataHashed()` — included in every subsequent push

### Auto-populate from Cookies

On module load, `firstName` and `lastName` cookies are read and SHA-256 hashed into `user_data.address.sha256_first_name` and `sha256_last_name`. This is fire-and-forget (async, no await) — if the first event push happens before hashing completes, those fields default to empty strings.

---

## `logged_in` Derivation

The `logged_in` field in the user context is derived from three cookies:

```
logged_in = !!userId && !!patientId && appAuth === 'true'
```

All three must be present:
- `userId` cookie (non-empty)
- `patientId` cookie (non-empty)
- `app_is_authenticated` cookie (exactly `'true'`)

Manual override via `setUser({ logged_in: true })` takes precedence.

---

## Architecture & Design Decisions

### Event Delegation for DOM Binding

The module uses document-level `click` and `touchend` listeners:

```typescript
doc.addEventListener('click', handleInteraction, { capture: false, passive: false });
doc.addEventListener('touchend', handleInteraction, { capture: false, passive: false });
```

**Why `passive: false`:** The handler calls `e.preventDefault()` on anchor elements to intercept navigation. This requires `passive: false` to allow `preventDefault()`.

**Why event delegation:** Elements added after DOMContentLoaded (Webflow interactions, JS rendering) are automatically tracked without MutationObserver.

### Anchor hitCallback

When a `data-dl-event` element is an `<a>` tag with an `href`:

1. `e.preventDefault()` intercepts the click
2. The event is pushed to dataLayer
3. `setTimeout` navigates to the href after `navigationDelay` (default: 100ms)

This ensures the dataLayer push is captured before the browser navigates away.

### Debounce with Map Pruning

Click/touchend events on the same element are debounced with a 300ms window. The debounce map is pruned every 100 writes to prevent memory leaks on long-lived pages.

### Ecommerce Null Clear

Before every ecommerce push, `{ ecommerce: null }` is pushed to clear stale ecommerce data from previous pushes (GTM best practice).

---

## Validation & Fallbacks

### User Context

| Condition | Behavior |
|-----------|----------|
| `userId` cookie missing | `pp_user_id` defaults to `''` |
| `patientId` cookie missing | `pp_patient_id` defaults to `''` |
| `app_is_authenticated` cookie missing or not `'true'` | `logged_in` defaults to `false` |
| Manual `setUser()` override | Override fields take precedence over cookies |

### User Data

| Condition | Behavior |
|-----------|----------|
| PII field is empty/undefined | SHA-256 hash is `''` (empty string) |
| Value already matches SHA-256 pattern | Passed through (not re-hashed) |
| `crypto.subtle` unavailable | Hashing fails silently; fields remain `''` |

### DOM Binding

| Condition | Behavior |
|-----------|----------|
| Click target has no `data-dl-event` ancestor | Silently ignored |
| `data-dl-event` value is empty after sanitization | Event skipped |
| Duplicate click within 300ms | Debounced (suppressed) |
| Handler throws | Caught and logged via `ppLib.log('error', ...)` |

### Item Normalization

| Field | Invalid Input | Fallback |
|-------|---------------|----------|
| `price` | Non-numeric string | `0` |
| `quantity` | Missing or `0` | `1` |
| `discount` | Non-numeric string | `0` |

---

## Known Limitations

1. **No batching** — Each event pushes immediately to `window.dataLayer`. No queue or throttle.

2. **Cookie auto-populate is fire-and-forget** — The SHA-256 hashing of `firstName`/`lastName` cookies is async. If the first event push happens before hashing completes, `user_data.address` will have empty name fields.

3. **Debounce uses element identity** — Composite key is `tagName:id/eventName`. Different elements with the same tag and event name could theoretically collide.

4. **Anchor delay is fixed** — The 100ms `navigationDelay` is not adaptive. On slow connections where the dataLayer push takes longer, the navigation may fire before GTM processes the event.

---

## Dependencies

- **common** (`window.ppLib`) — getCookie, Security (sanitize, validateData), extend, logging
