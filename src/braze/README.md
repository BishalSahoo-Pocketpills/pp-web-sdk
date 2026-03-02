# Braze Module

Data-attribute-driven Braze integration for PocketPills web properties. Marketing teams can set up event tracking, user profiles, and purchase tracking by adding HTML attributes — no JavaScript required after the initial setup.

**Output:** `braze.min.js` | **Global:** `ppLib.braze`

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Source Files](#source-files)
3. [Configuration Reference](#configuration-reference)
4. [User Identity](#user-identity)
5. [Form Tracking](#form-tracking)
6. [Event Tracking](#event-tracking)
7. [Purchase Tracking](#purchase-tracking)
8. [User Attributes](#user-attributes)
9. [GTM Ecommerce Bridge](#gtm-ecommerce-bridge)
10. [Programmatic API](#programmatic-api)
11. [Consent Management](#consent-management)
12. [Debouncing](#debouncing)
13. [Architecture](#architecture)

---

## Quick Start

Add the scripts and initialization block to your page. Everything else is done via HTML data attributes.

```html
<script src="/common.min.js"></script>
<script src="/braze.min.js"></script>
<script>
  ppLib.braze.configure({
    sdk: {
      apiKey: 'YOUR_SDK_API_KEY',
      baseUrl: 'sdk.iad-07.braze.com'
    }
  });
  ppLib.braze.init();
</script>
```

The `apiKey` is a **public client-side key** from Braze (Settings > API Keys > SDK API Key). It is safe to include in HTML.

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Main entry point — public API, IIFE wrapper, module registration |
| `config.ts` | Default configuration factory (SDK URL, timeouts, attribute names) |
| `sdk-loader.ts` | CDN script loading, stub queue pattern, drain mechanism |
| `user.ts` | identify, setEmail, setUserAttributes, processFormAttrs, STANDARD_ATTRS map |
| `forms.ts` | Form submit handler, field extraction, debounce, requireEmail |
| `events.ts` | Click/touchend event handler, `data-braze-prop-*` extraction, page context |
| `purchases.ts` | Purchase click handler, programmatic API, GTM ecommerce bridge |

---

## Configuration Reference

All options are passed via `ppLib.braze.configure({ ... })` before calling `init()`. Every option has a sensible default — you only need to set `sdk.apiKey` and `sdk.baseUrl`.

### `sdk` — Braze SDK Settings

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `''` | **Required.** Braze SDK API key. |
| `baseUrl` | `string` | `''` | **Required.** Braze SDK endpoint (e.g. `sdk.iad-07.braze.com`). |
| `cdnUrl` | `string` | `https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js` | Braze SDK CDN URL. Override to pin a specific version. |
| `enableLogging` | `boolean` | `false` | Enable Braze SDK debug logging in the browser console. |
| `sessionTimeoutInSeconds` | `number` | `1800` | Session inactivity timeout (30 min default). |

### `consent` — Consent Gating

| Option | Type | Default | Description |
|---|---|---|---|
| `required` | `boolean` | `false` | If `true`, SDK will not load until consent is granted. |
| `mode` | `'analytics' \| 'custom'` | `'analytics'` | `analytics` reads from `ppAnalytics.consent.status()`. `custom` uses `checkFunction`. |
| `checkFunction` | `() => boolean` | `() => true` | Custom consent check function (used when `mode: 'custom'`). |

### `identity` — Auto-Identification

| Option | Type | Default | Description |
|---|---|---|---|
| `autoIdentify` | `boolean` | `true` | Automatically identify users from cookies on SDK load. |
| `userIdCookie` | `string` | `'userId'` | Cookie name containing the user's external ID. |
| `emailCookie` | `string` | `''` | Cookie name containing the user's email. Set empty to skip. |

### `form` — Form Handling

| Option | Type | Default | Description |
|---|---|---|---|
| `formAttribute` | `string` | `'data-braze-form'` | HTML attribute that marks a form for tracking. |
| `fieldAttribute` | `string` | `'data-braze-attr'` | HTML attribute on inputs that maps to Braze user attributes. |
| `formEventAttribute` | `string` | `'data-braze-form-event'` | HTML attribute to override the auto-generated event name. |
| `preventDefault` | `boolean` | `false` | Prevent the default form submission (useful for AJAX forms). |
| `debounceMs` | `number` | `500` | Debounce window per form name to prevent duplicate submissions. |
| `flushOnSubmit` | `boolean` | `true` | Call `requestImmediateDataFlush()` after form submit to flush before page navigation. |
| `requireEmail` | `boolean` | `false` | Reject form if the `email` field is empty. |

### `event` — Event Tracking

| Option | Type | Default | Description |
|---|---|---|---|
| `eventAttribute` | `string` | `'data-braze-event'` | HTML attribute that marks an element for click event tracking. |
| `propPrefix` | `string` | `'data-braze-prop-'` | Prefix for dynamic event property attributes. |
| `debounceMs` | `number` | `300` | Debounce window per element to prevent duplicate events. |
| `includePageContext` | `boolean` | `true` | Auto-add `page_url`, `page_path`, `page_title` to event properties. |

### `purchase` — Purchase Tracking

| Option | Type | Default | Description |
|---|---|---|---|
| `bridgeEcommerce` | `boolean` | `false` | Monitor `window.dataLayer` for GTM `add_to_cart` events. |
| `defaultCurrency` | `string` | `'CAD'` | Fallback currency code when `data-braze-currency` is not set. |

### `attributeMap` — Field Name Remapping

| Option | Type | Default | Description |
|---|---|---|---|
| `attributeMap` | `Record<string, string>` | `{}` | Remap form field names to Braze attribute names. |

Example:

```javascript
ppLib.braze.configure({
  attributeMap: {
    'signup_email': 'email',      // field "signup_email" → Braze "email"
    'phone_number': 'phone',      // field "phone_number" → Braze "phone"
    'user_dob': 'dob'             // field "user_dob" → Braze "dob"
  }
});
```

---

## User Identity

### Auto-Identify from Cookies

When `identity.autoIdentify` is `true` (default), the SDK reads the `userId` cookie on page load and calls `braze.changeUser()` automatically.

```javascript
// User visits with cookie: userId=user-abc-123
// SDK automatically calls: braze.changeUser('user-abc-123')
```

If `identity.emailCookie` is set, the SDK also reads that cookie and calls `setEmail()`.

### Manual Identify

```javascript
ppLib.braze.identify('user-abc-123');
```

Call this after login, signup, or any point where you know the user's ID.

---

## Form Tracking

Form tracking is the primary way marketing teams push user data to Braze. Add data attributes to any HTML form — no JavaScript needed.

### Basic Form

```html
<form data-braze-form="newsletter_signup">
  <input data-braze-attr="email" name="email" type="email" />
  <input data-braze-attr="first_name" name="name" />
  <button type="submit">Subscribe</button>
</form>
```

**What happens on submit:**
1. Extracts all `data-braze-attr` field values
2. Sets `email` via `braze.getUser().setEmail()` (standard attribute)
3. Sets `first_name` via `braze.getUser().setFirstName()` (standard attribute)
4. Fires custom event: `form_submitted_newsletter_signup`
5. Flushes data to Braze immediately

### Standard Attributes

These field names map to dedicated Braze user profile setters:

| `data-braze-attr` value | Braze setter | Description |
|---|---|---|
| `email` | `setEmail()` | Email address |
| `first_name` | `setFirstName()` | First name |
| `last_name` | `setLastName()` | Last name |
| `phone` | `setPhoneNumber()` | Phone number |
| `gender` | `setGender()` | Gender |
| `dob` | `setDateOfBirth()` | Date of birth |
| `country` | `setCountry()` | Country |
| `city` | `setHomeCity()` | City |
| `language` | `setLanguage()` | Language preference |

### Custom Attributes (the `custom:` prefix)

Any field prefixed with `custom:` creates a Braze custom user attribute:

```html
<form data-braze-form="onboarding">
  <input data-braze-attr="email" name="email" type="email" />
  <input data-braze-attr="custom:preferred_pharmacy" name="pharmacy" />
  <input data-braze-attr="custom:referral_source" name="referral" />
  <input data-braze-attr="custom:insurance_provider" name="insurance" />
  <button type="submit">Complete</button>
</form>
```

This sets three custom attributes on the Braze user profile:
- `preferred_pharmacy` = "Downtown Pharmacy"
- `referral_source` = "google_ads"
- `insurance_provider` = "Sun Life"

### Full Form Example (all attribute types)

```html
<form data-braze-form="lead_capture">
  <!-- Standard attributes -->
  <input data-braze-attr="email" name="email" type="email" placeholder="Email" />
  <input data-braze-attr="first_name" name="first_name" placeholder="First name" />
  <input data-braze-attr="last_name" name="last_name" placeholder="Last name" />
  <input data-braze-attr="phone" name="phone" placeholder="Phone" />
  <input data-braze-attr="country" name="country" placeholder="Country" />
  <input data-braze-attr="city" name="city" placeholder="City" />

  <!-- Custom attributes -->
  <input data-braze-attr="custom:preferred_pharmacy" name="pharmacy" placeholder="Pharmacy" />
  <input data-braze-attr="custom:referral_source" name="referral" placeholder="How did you hear?" />

  <button type="submit">Submit</button>
</form>
```

### Custom Event Name Override

By default, form submit fires `form_submitted_{form_name}`. Override this with `data-braze-form-event`:

```html
<form data-braze-form="contact_us"
      data-braze-form-event="custom_contact_event">
  <input data-braze-attr="email" name="email" type="email" />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

This fires `custom_contact_event` instead of `form_submitted_contact_us`.

### Form Event Properties

Every form submission event automatically includes these properties:

```json
{
  "form_name": "lead_capture",
  "page_url": "https://example.com/signup",
  "page_path": "/signup",
  "page_title": "Sign Up — PocketPills"
}
```

### Requiring Email

To reject form submissions that don't include an email:

```javascript
ppLib.braze.configure({
  form: { requireEmail: true }
});
```

---

## Event Tracking

Track click interactions on any HTML element by adding data attributes.

### Basic Click Event

```html
<button data-braze-event="started_signup">
  Get Started
</button>
```

Clicking this button fires `braze.logCustomEvent('started_signup')`.

### Click Event with Properties

Add dynamic properties using the `data-braze-prop-*` prefix:

```html
<button data-braze-event="started_signup"
        data-braze-prop-source="hero_banner"
        data-braze-prop-plan="premium"
        data-braze-prop-campaign="spring_2026">
  Get Started
</button>
```

This fires:

```json
{
  "event": "started_signup",
  "properties": {
    "source": "hero_banner",
    "plan": "premium",
    "campaign": "spring_2026",
    "page_url": "https://example.com/pricing",
    "page_path": "/pricing",
    "page_title": "Pricing — PocketPills"
  }
}
```

### Event on Any Element

Works on any clickable element — links, divs, spans, images:

```html
<!-- Link -->
<a href="/pricing" data-braze-event="viewed_pricing"
   data-braze-prop-source="nav_menu">
  Pricing
</a>

<!-- Card/div -->
<div data-braze-event="product_clicked"
     data-braze-prop-product="rx-vitamins"
     data-braze-prop-category="supplements">
  <img src="vitamins.jpg" />
  <h3>Rx Vitamins</h3>
</div>
```

### Page Context

By default, every event automatically includes `page_url`, `page_path`, and `page_title`. Disable this with:

```javascript
ppLib.braze.configure({
  event: { includePageContext: false }
});
```

---

## Purchase Tracking

Track purchases via click interactions on HTML elements or programmatically.

### Click-Driven Purchase

```html
<button data-braze-purchase="assessment-pkg"
        data-braze-price="60"
        data-braze-currency="CAD"
        data-braze-quantity="2">
  Buy Assessment Package — $60 x2
</button>
```

| Attribute | Required | Description |
|---|---|---|
| `data-braze-purchase` | Yes | Product ID |
| `data-braze-price` | Yes | Price as a number (e.g. `"60"`, `"29.99"`) |
| `data-braze-currency` | No | 3-letter ISO currency code. Defaults to config `purchase.defaultCurrency` (`CAD`). |
| `data-braze-quantity` | No | Integer quantity. Defaults to `1`. |

### Purchase on Links and Cards

```html
<a href="/checkout/premium"
   data-braze-purchase="premium-plan"
   data-braze-price="49.99"
   data-braze-currency="CAD">
  Upgrade to Premium
</a>
```

### Programmatic Purchase

```javascript
ppLib.braze.trackPurchase('rx-plan', 29.99, 'CAD', 1);

// With custom properties
ppLib.braze.trackPurchase('rx-plan', 29.99, 'CAD', 1, {
  discount_code: 'SPRING20',
  plan_type: 'monthly'
});
```

---

## User Attributes

### Via Form (recommended for marketing)

See [Form Tracking](#form-tracking) — the `data-braze-attr` approach.

### Via `setEmail()`

```javascript
ppLib.braze.setEmail('user@example.com');
```

### Via `setUserAttributes()` (bulk)

Set multiple standard and custom attributes in a single call:

```javascript
ppLib.braze.setUserAttributes({
  // Standard attributes (use dedicated Braze setters)
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '+1-555-0199',
  gender: 'female',
  country: 'CA',
  city: 'Toronto',
  language: 'en',

  // Custom attributes (any other key becomes a custom attribute)
  loyalty_tier: 'gold',
  signup_channel: 'web',
  preferred_pharmacy: 'Downtown Pharmacy'
});
```

Standard attribute names (`email`, `first_name`, `last_name`, `phone`, `gender`, `dob`, `country`, `city`, `language`) are automatically routed to their dedicated Braze setters. All other keys become custom attributes.

### Attribute Remapping

If your form field names don't match Braze attribute names, use `attributeMap`:

```html
<form data-braze-form="signup">
  <input data-braze-attr="signup_email" name="signup_email" />
  <input data-braze-attr="phone_number" name="phone_number" />
</form>

<script>
  ppLib.braze.configure({
    attributeMap: {
      'signup_email': 'email',
      'phone_number': 'phone'
    }
  });
</script>
```

---

## GTM Ecommerce Bridge

Automatically track purchases from Google Tag Manager `add_to_cart` events pushed to `window.dataLayer`.

### Enable

```javascript
ppLib.braze.configure({
  purchase: { bridgeEcommerce: true }
});
```

### How It Works

When enabled, the SDK intercepts `dataLayer.push()` calls. If an `add_to_cart` event is detected, each item is automatically tracked as a Braze purchase:

```javascript
// GTM or your ecommerce platform pushes this:
dataLayer.push({
  event: 'add_to_cart',
  ecommerce: {
    currency: 'CAD',
    items: [
      { item_id: 'SKU-001', price: '29.99', quantity: 2 },
      { item_id: 'SKU-002', price: '14.99', quantity: 1 }
    ]
  }
});

// SDK automatically calls:
// braze.logPurchase('SKU-001', 29.99, 'CAD', 2)
// braze.logPurchase('SKU-002', 14.99, 'CAD', 1)
```

---

## Programmatic API

For cases where data attributes aren't sufficient, the full API is available via `ppLib.braze`:

| Method | Description |
|---|---|
| `configure(options)` | Merge configuration options. Call before `init()`. |
| `init()` | Load the Braze SDK and bind DOM handlers. |
| `identify(userId)` | Set the user's external ID via `braze.changeUser()`. |
| `setEmail(email)` | Set the user's email address. |
| `setUserAttributes(attrs)` | Set multiple user attributes (standard + custom). |
| `trackEvent(name, properties?)` | Fire a custom event. |
| `trackPurchase(productId, price, currency?, quantity?, properties?)` | Log a purchase. |
| `flush()` | Force an immediate data flush to Braze servers. |
| `isReady()` | Returns `true` once the Braze SDK has loaded and initialized. |
| `getConfig()` | Returns the current configuration object. |

### Examples

```javascript
// Identify a user after login
ppLib.braze.identify('user-abc-123');

// Track a custom event
ppLib.braze.trackEvent('completed_onboarding', {
  steps_completed: '5',
  time_spent: '120s'
});

// Track a purchase
ppLib.braze.trackPurchase('premium-plan', 49.99, 'CAD', 1, {
  discount_code: 'WELCOME20'
});

// Set custom user attributes
ppLib.braze.setUserAttributes({
  loyalty_tier: 'gold',
  preferred_pharmacy: 'Queen St. Pharmacy'
});

// Force flush before navigation
ppLib.braze.flush();
```

---

## Consent Management

The SDK supports consent gating — it won't load the Braze SDK until consent is granted.

### Using ppAnalytics consent (default)

```javascript
ppLib.braze.configure({
  consent: {
    required: true,
    mode: 'analytics' // reads ppAnalytics.consent.status()
  }
});
```

### Using a custom consent function

```javascript
ppLib.braze.configure({
  consent: {
    required: true,
    mode: 'custom',
    checkFunction: function() {
      return document.cookie.includes('consent=accepted');
    }
  }
});
```

If consent is not granted when `init()` is called, the SDK logs a message and does not load.

---

## Debouncing

All interactions are debounced to prevent duplicate events from rapid clicks or form submissions.

| Interaction | Default | Config Key |
|---|---|---|
| Form submit | 500ms per form name | `form.debounceMs` |
| Click event | 300ms per element | `event.debounceMs` |
| Purchase click | 300ms per product+price | `event.debounceMs` |

The debounce key for events is based on the element's tag, event name, and inner text, so the same event on different elements is tracked independently.

---

## Architecture

### Data Flow

```
HTML Element (data-braze-*)
  → DOM Event (click/submit/touchend)
    → Handler (events.ts / forms.ts / purchases.ts)
      → Sanitize values (ppLib.Security.sanitize)
        → Braze SDK (logCustomEvent / logPurchase / setEmail / etc.)
          → Braze Servers (sdk.iad-XX.braze.com)
```

### How It Works

1. `ppLib.braze.configure()` merges options into the default config
2. `ppLib.braze.init()` checks consent, then loads the Braze SDK from CDN
3. While the SDK loads, all API calls are queued in a stub
4. On SDK load: `braze.initialize()` + `braze.openSession()` are called, then the queue is drained
5. DOM event listeners are bound for `submit`, `click`, and `touchend`
6. All user input is sanitized via `ppLib.Security.sanitize()` before being sent to Braze

### Security

- All values are sanitized before being sent to Braze (XSS prevention)
- The SDK API key is a public client-side key (safe to embed in HTML)
- REST API keys are never used client-side
- The SDK respects consent gating when configured

---

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging, getCookie, extend
- **analytics** (`window.ppAnalytics`) — Optional; used for consent status when `consent.mode: 'analytics'`
- **Braze CDN** — SDK loaded dynamically at runtime (`https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js`)

## Testing

Live round-trip tests verify all data types end-to-end against Braze staging:

```bash
# Mock tests (no credentials needed)
pnpm run test:e2e

# Live round-trip tests (requires BRAZE_API_KEY, BRAZE_BASE_URL, BRAZE_REST_API_KEY, BRAZE_REST_URL)
pnpm run test:e2e:live
```

See `e2e/braze-live.spec.ts` for the live integration test suite covering all 11 data types.
