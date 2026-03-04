# pp-web-sdk

Modular web SDK for PocketPills web properties. Provides analytics, attribution, login detection, ecommerce tracking, Mixpanel integration, and Braze engagement — all driven by HTML data attributes.

**Version:** 2.0.1 | **Language:** TypeScript | **Build:** esbuild (IIFE) | **Tests:** Vitest + Playwright

---

## Architecture

The SDK is a collection of **independent IIFE modules** that share a common foundation via `window.ppLib`. Each module is a self-contained JavaScript bundle that can be loaded individually based on page requirements.

```
window.ppLib                     (common.min.js — MUST load first)
  ├── .version                   → SDK version
  ├── .config                    → Global configuration
  ├── .log(level, msg, data?)    → Debug/verbose logger
  ├── .SafeUtils                 → Null-safe get/set/forEach/exists
  ├── .Security                  → Input sanitization & XSS prevention
  ├── .Storage                   → sessionStorage/localStorage abstraction
  ├── .getCookie(name)           → Cookie reader
  ├── .deleteCookie(name)        → Cookie remover
  ├── .getQueryParam(url, param) → URL parameter extractor
  ├── .extend(target, source)    → Deep object merge (prototype-safe)
  ├── .login                     → Auth state & body class management
  ├── .ecommerce                 → GA4 ecommerce events
  ├── .eventSource               → Click/tap event tracking
  ├── .mixpanel                  → Mixpanel SDK wrapper & sessions
  ├── .braze                     → Braze engagement platform
  └── .voucherify                → Voucherify pricing & discounts

window.ppAnalytics               (analytics.min.js)
  ├── .config(options?)          → Attribution & multi-platform analytics
  ├── .consent                   → Grant/revoke/status consent management
  ├── .track(event, props?)      → Multi-platform event dispatch
  ├── .getAttribution()          → First/last touch data
  └── .registerPlatform(name, h) → Custom platform registration
```

### Module Loading Order

`common.min.js` **must** load first. It initializes `window.ppLib` and processes the `ppLibReady` callback queue. All other modules register themselves via this queue, so they can load in any order after common.

```html
<!-- Required: loads first -->
<script src="https://cdn.example.com/common.min.js"></script>

<!-- Optional: load only what the page needs, in any order -->
<script src="https://cdn.example.com/analytics.min.js"></script>
<script src="https://cdn.example.com/login.min.js"></script>
<script src="https://cdn.example.com/braze.min.js"></script>
```

### Module Registry

| Module | Output File | Global API | Purpose | README |
|---|---|---|---|---|
| common | `common.min.js` | `window.ppLib` | Shared utilities, security, storage | [src/common/](src/common/README.md) |
| analytics | `analytics.min.js` | `window.ppAnalytics` | Attribution, consent, multi-platform events | [src/analytics/](src/analytics/README.md) |
| ecommerce | `ecommerce.min.js` | `ppLib.ecommerce` | GA4 ecommerce events from data attributes | [src/ecommerce/](src/ecommerce/README.md) |
| event-source | `event-source.min.js` | `ppLib.eventSource` | Click/tap tracking via `data-event-source` | [src/event-source/](src/event-source/README.md) |
| login | `login.min.js` | `ppLib.login` | Auth state detection, body classes, identity | [src/login/](src/login/README.md) |
| mixpanel | `mixpanel.min.js` | `ppLib.mixpanel` | Mixpanel SDK loader, sessions, UTM | [src/mixpanel/](src/mixpanel/README.md) |
| braze | `braze.min.js` | `ppLib.braze` | Braze forms, events, purchases, identity | [src/braze/](src/braze/README.md) |
| voucherify | `voucherify.min.js` | `ppLib.voucherify` | Voucherify pricing, discounts, voucher validation | [src/voucherify/](src/voucherify/README.md) |

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Styles — load early to prevent FOUC -->
  <link rel="stylesheet" href="https://cdn.example.com/login.min.css">

  <!-- Load modules with defer to preserve execution order -->
  <script defer src="https://cdn.example.com/common.min.js"></script>
  <script defer src="https://cdn.example.com/analytics.min.js"></script>
  <script defer src="https://cdn.example.com/login.min.js"></script>
  <script defer src="https://cdn.example.com/ecommerce.min.js"></script>
  <script defer src="https://cdn.example.com/event-source.min.js"></script>
  <script defer src="https://cdn.example.com/braze.min.js"></script>
</head>
<body>
  <!-- Event tracking via data attributes — no JavaScript needed -->
  <button data-event-source="signup_cta"
          data-braze-event="started_signup"
          data-braze-prop-source="hero_banner">
    Get Started
  </button>

  <!-- Ecommerce tracking -->
  <section data-ecommerce-item="weight-loss"
           data-ecommerce-name="Weight Loss"
           data-ecommerce-price="60">
    <button data-event-source="add_to_cart">Start Assessment</button>
  </section>

  <!-- Login-aware visibility -->
  <div data-visibility="logged-out">
    <button data-event-source="login_cta">Log In</button>
  </div>
  <div data-visibility="logged-in">
    Welcome, <span data-login-identifier-key="user-first-name"></span>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // Configure Braze
      ppLib.braze.configure({
        sdk: { apiKey: 'YOUR_KEY', baseUrl: 'sdk.iad-07.braze.com' }
      });
      ppLib.braze.init();

      // Configure Mixpanel
      ppLib.mixpanel.configure({ token: 'YOUR_TOKEN' });
      ppLib.mixpanel.init();
    });
  </script>
</body>
</html>
```

> **Important:** Use `defer` (not `async`) to guarantee execution order. Configure/init calls should be inside `DOMContentLoaded` since `defer` scripts execute before that event fires.

---

## Development

### Prerequisites

- Node.js >= 18
- pnpm

### Setup

```bash
pnpm install
npx playwright install   # for e2e tests
```

### Build

```bash
pnpm run build           # typecheck + esbuild → dist/
pnpm run build:watch     # rebuild on file changes
```

The build reads the module list from `modules.js` and compiles each `src/<module>/index.ts` into `dist/<module>.min.js`.

| Setting | Value |
|---|---|
| Format | IIFE (immediately invoked function expression) |
| Target | ES2018 |
| Bundling | Enabled (all imports inlined) |
| Minification | Enabled |
| Charset | UTF-8 |

### Test

```bash
pnpm test                # unit tests (Vitest + jsdom)
pnpm run test:coverage   # unit tests with 100% coverage enforcement
pnpm run test:e2e        # end-to-end tests (Playwright)
pnpm run test:e2e:headed # e2e with visible browser
pnpm run test:e2e:live   # live Braze round-trip tests (requires credentials)
```

**Unit tests** use Vitest with jsdom. Each module's IIFE is compiled via a prebuild step and loaded with `vm.runInThisContext()` for V8 coverage attribution. Tests run in `pool: 'forks'` to isolate IIFE globals between files.

**E2e tests** use Playwright with a local `serve` static server on port 3456. Mock tests intercept CDN requests; live tests hit real Braze staging endpoints.

### Coverage

**100% coverage** is enforced on all metrics (lines, branches, functions, statements) for `src/*/index.ts` files.

---

## Project Structure

```
pp-web-sdk/
├── src/
│   ├── common/          → Shared foundation (ppLib, Security, Storage)
│   ├── analytics/       → Attribution & multi-platform analytics
│   ├── ecommerce/       → GA4 ecommerce event tracking
│   ├── event-source/    → Element click/tap tracking
│   ├── login/           → Auth state detection & body classes
│   ├── mixpanel/        → Mixpanel SDK wrapper & sessions
│   ├── braze/           → Braze engagement platform
│   ├── voucherify/      → Voucherify pricing & discounts
│   └── types/           → Shared TypeScript type definitions
├── tests/               → Unit tests (mirrors src/ structure)
├── e2e/                 → Playwright end-to-end tests
│   ├── fixtures/        → HTML test pages
│   └── helpers/         → Test utilities (mocks, API helpers)
├── dist/                → Build output (gitignored)
├── build.js             → esbuild build orchestrator
├── modules.js           → Canonical module list
├── vitest.config.ts     → Unit test configuration
├── playwright.config.ts → E2e test configuration
└── tsconfig.json        → TypeScript configuration
```

---

## Data Attributes Reference

All modules use `data-*` attributes for declarative, no-code configuration.

### Event Source (`data-event-source`)

```html
<button data-event-source="signup_cta"
        data-event-category="conversion"
        data-event-label="Hero CTA"
        data-event-value="49.99">
  Sign Up
</button>
```

### Ecommerce (`data-ecommerce-*`)

```html
<section data-ecommerce-item="weight-loss"
         data-ecommerce-name="Weight Loss"
         data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start Assessment</button>
</section>
```

### Voucherify Pricing (`data-voucherify-*`)

```html
<div data-voucherify-product="weight-loss"
     data-voucherify-base-price="60">
  <span data-voucherify-original-price></span>
  <span data-voucherify-discounted-price></span>
  <span data-voucherify-discount-label></span>
</div>
```

### Braze Events (`data-braze-event`, `data-braze-purchase`)

```html
<button data-braze-event="started_signup"
        data-braze-prop-source="hero_banner">Get Started</button>

<button data-braze-purchase="assessment-pkg"
        data-braze-price="60"
        data-braze-currency="CAD"
        data-braze-quantity="1">Buy Package</button>
```

### Braze Forms (`data-braze-form`, `data-braze-attr`)

```html
<form data-braze-form="lead_capture">
  <input data-braze-attr="email" name="email" type="email" />
  <input data-braze-attr="first_name" name="first_name" />
  <input data-braze-attr="custom:preferred_pharmacy" name="pharmacy" />
  <button type="submit">Subscribe</button>
</form>
```

### Login Visibility (`data-visibility`)

```html
<div data-visibility="logged-out">Show when logged out</div>
<div data-visibility="logged-in">Show when logged in</div>
<div data-visibility="has-previous-user">Welcome back message</div>
<span data-login-identifier-key="user-first-name"></span>
<button data-action="logout">Log Out</button>
```

---

## API Reference

### `window.ppLib` (Common)

| Method | Description |
|---|---|
| `ppLib.getCookie(name)` | Read a cookie value |
| `ppLib.deleteCookie(name)` | Delete a cookie |
| `ppLib.getQueryParam(url, param)` | Extract URL parameter (case-insensitive) |
| `ppLib.Storage.set(key, value, persistent?)` | Store data (session or persistent) |
| `ppLib.Storage.get(key, persistent?)` | Retrieve stored data |
| `ppLib.Security.sanitize(input)` | Sanitize string input (XSS prevention) |
| `ppLib.Security.isValidUrl(url)` | Validate URL (http/https only) |
| `ppLib.SafeUtils.get(obj, path, default?)` | Null-safe deep property access |
| `ppLib.extend(target, source)` | Deep merge objects |

### `window.ppAnalytics` (Analytics)

| Method | Description |
|---|---|
| `ppAnalytics.config(options?)` | Configure attribution and platform settings |
| `ppAnalytics.track(event, props?)` | Track event across all registered platforms |
| `ppAnalytics.getAttribution()` | Get first/last touch attribution data |
| `ppAnalytics.consent.grant()` | Grant tracking consent |
| `ppAnalytics.consent.revoke()` | Revoke tracking consent |
| `ppAnalytics.consent.status()` | Check consent status |
| `ppAnalytics.registerPlatform(name, handler)` | Register custom analytics platform |
| `ppAnalytics.clear()` | Clear stored attribution data |

### `ppLib.ecommerce` (Ecommerce)

| Method | Description |
|---|---|
| `ppLib.ecommerce.configure(options)` | Override defaults (brand, category, currency) |
| `ppLib.ecommerce.trackViewItem()` | Re-fire `view_item` from DOM scan |
| `ppLib.ecommerce.trackItem(itemData)` | Programmatic `add_to_cart` |
| `ppLib.ecommerce.getItems()` | Get parsed items from DOM |

### `ppLib.eventSource` (Event Source)

| Method | Description |
|---|---|
| `ppLib.eventSource.configure(options)` | Update config |
| `ppLib.eventSource.trackElement(element)` | Track a specific DOM element |
| `ppLib.eventSource.trackCustom(source, props)` | Track custom event programmatically |

### `ppLib.login` (Login)

| Method | Description |
|---|---|
| `ppLib.login.configure(options)` | Update cookie names, body classes |
| `ppLib.login.isLoggedIn()` | Check auth state |
| `ppLib.login.logout(hard?)` | Trigger logout (soft or hard) |
| `window.logoutUser(hard?)` | Global logout function |

### `ppLib.mixpanel` (Mixpanel)

| Method | Description |
|---|---|
| `ppLib.mixpanel.configure(options)` | Set token, project name, session timeout |
| `ppLib.mixpanel.init()` | Load SDK and initialize |
| `ppLib.mixpanel.getMixpanelCookieData()` | Parse Mixpanel cookie |

### `ppLib.braze` (Braze)

| Method | Description |
|---|---|
| `ppLib.braze.configure(options)` | Set API key, base URL, form/event config |
| `ppLib.braze.init()` | Load Braze SDK from CDN and initialize |
| `ppLib.braze.identify(userId)` | Set external user ID |
| `ppLib.braze.setEmail(email)` | Set user email |
| `ppLib.braze.setUserAttributes(attrs)` | Set standard + custom attributes |
| `ppLib.braze.trackEvent(name, props?)` | Log custom event |
| `ppLib.braze.trackPurchase(id, price, currency, qty)` | Log purchase |
| `ppLib.braze.flush()` | Force-flush pending data |
| `ppLib.braze.isReady()` | Check if SDK is loaded |

### `ppLib.voucherify` (Voucherify)

| Method | Description |
|---|---|
| `ppLib.voucherify.configure(options)` | Set API keys, cache mode, pricing attributes |
| `ppLib.voucherify.init()` | Check consent and auto-fetch pricing |
| `ppLib.voucherify.fetchPricing(productIds?)` | Fetch pricing and inject into DOM |
| `ppLib.voucherify.validateVoucher(code, context?)` | Validate a voucher code |
| `ppLib.voucherify.checkQualifications(context?)` | Query all applicable promotions |
| `ppLib.voucherify.clearCache()` | Clear in-memory response cache |
| `ppLib.voucherify.isReady()` | Always `true` (no CDN SDK to load) |
| `ppLib.voucherify.getConfig()` | Get current config |

---

## Design Principles

1. **Data-attribute driven** — Marketing teams configure tracking via HTML attributes, no JavaScript required
2. **Module independence** — Each module is a standalone IIFE; load only what you need
3. **Security first** — All inputs sanitized via `ppLib.Security.sanitize()` (XSS, injection prevention)
4. **Silent failure** — Errors are caught and logged, never thrown to consumer code
5. **Factory functions** — Sub-modules use factory pattern (not classes) for dependency injection
6. **100% test coverage** — Enforced at build time via V8 coverage provider

## Browser Support

Modern browsers (Chrome, Firefox, Safari, Edge). ES2018 target. IE11 is not supported.
