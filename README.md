# pp-web-sdk

Modular web SDK for analytics, attribution, login detection, event tracking, and more.

## Modules

| Module | File | Description |
|--------|------|-------------|
| **Common** | `common/index.js` | Shared utilities, security, storage — **load first** |
| **Analytics** | `analytics/index.js` | UTM/ad attribution, consent, GTM/GA4/Mixpanel event queue |
| **Mixpanel** | `mixpanel/index.js` | Mixpanel SDK loader, session management, campaign params |
| **Login** | `login/index.js` | Cookie-based auth detection, body class management, identity DOM injection |
| **Event Source** | `event-source/index.js` | Auto-track clicks/taps on `data-event-source` elements |
| **Ecommerce** | `ecommerce/index.js` | Data-attribute-driven GA4 ecommerce events (`view_item`, `add_to_cart`) |
| **Login CSS** | `login/index.css` | Login visibility CSS for `data-visibility` elements |

## Installation

### Script Tags (via Cloudflare Pages CDN)

```html
<!-- Styles — load early to prevent FOUC -->
<link rel="stylesheet" href="https://pp-web-sdk-v1.pages.dev/login.min.css">

<!-- Load all modules with defer to preserve execution order -->
<script defer src="https://pp-web-sdk-v1.pages.dev/common.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/analytics.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/mixpanel.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/event-source.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/ecommerce.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/login.min.js"></script>

<!-- Configure Mixpanel after modules load -->
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ppLib && window.ppLib.mixpanel) {
      ppLib.mixpanel.configure({
        token: 'YOUR_MIXPANEL_TOKEN',
        projectName: 'your-project'
      });
      ppLib.mixpanel.init();
    }
  });
</script>
```

> **Important:** Always use `defer` (not `async`) to guarantee execution order. The configure/init call must be inside `DOMContentLoaded` since `defer` scripts execute before that event fires.

For version-pinned URLs (recommended for production), use the deploy hash:
```
https://<deploy-hash>.pp-web-sdk-v1.pages.dev/common.min.js
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
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ppLib && window.ppLib.mixpanel) {
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
    }
  });
</script>
```

### Login Detection

```html
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ppLib && window.ppLib.login) {
      ppLib.login.configure({
        cookieNames: {
          userId: 'userId',
          auth: 'Authorization'
        }
      });
    }
  });
</script>
```

## Data Attributes Reference

### Event Source Tracking (`data-event-source`)

Add `data-event-source` to any interactive element. Clicks and taps are auto-tracked to Mixpanel and GTM/GA4.

```html
<button data-event-source="signup_cta">Sign Up</button>
<a href="/pricing" data-event-source="pricing_link">View Pricing</a>
```

Optional attributes for richer event data:

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

### Login Visibility (`data-visibility`)

Control element visibility based on auth state. The `login.js` module adds classes to `<body>` automatically, and `login.min.css` provides the CSS rules to show/hide `[data-visibility]` elements.

**Body classes applied:**

| State | Class |
|---|---|
| Logged in | `is-logged-in` |
| Logged out | `is-logged-out` |
| Signup completed | `signup-completed` |
| Returning user | `has-previous-user` |
| DOM ready | `dom-ready` |

**CSS rules** (included in `login.min.css`):

```css
body:not(.dom-ready) [data-visibility] { opacity: 0; }
body.is-logged-out [data-visibility="logged-in"] { display: none !important; }
body.is-logged-in [data-visibility="logged-out"] { display: none !important; }
body:not(.has-previous-user) [data-visibility="has-previous-user"] { display: none !important; }
body:not(.signup-completed) [data-visibility="signup-completed"] { display: none !important; }
```

**HTML usage:**

```html
<!-- Only visible when logged OUT -->
<div data-visibility="logged-out">
  <button data-event-source="login_cta">Log In</button>
  <button data-event-source="signup_cta">Sign Up</button>
</div>

<!-- Only visible when logged IN -->
<div data-visibility="logged-in">
  <span>Welcome, <span data-login-identifier-key="user-first-name"></span></span>
  <button data-action="logout">Log Out</button>
</div>

<!-- Only visible for returning users -->
<div data-visibility="has-previous-user">
  <p>Welcome back, <span data-login-identifier-key="user-first-name"></span>!</p>
</div>

<!-- Only visible after signup completion -->
<div data-visibility="signup-completed">
  <p>Your account is ready!</p>
</div>
```

### Identity DOM Injection (`data-login-identifier-key`)

Inject user data into text elements. The module reads from cookies and populates matching elements:

```html
<span data-login-identifier-key="user-first-name"></span>
```

### Action Buttons (`data-action`)

```html
<!-- Soft logout: clears session cookies, keeps "remember me" data -->
<button data-action="logout">Log Out</button>

<!-- Hard logout: clears all cookies including previous user data -->
<button data-action="forget-me">Forget Me</button>
```

## Ecommerce Events

GA4 standard ecommerce events (`view_item`, `add_to_cart`) are handled automatically by the `ecommerce.js` module. No inline scripts needed — just add data attributes to your HTML.

### Data Attributes

| Attribute | Required | Description |
|---|---|---|
| `data-ecommerce-item` | Yes | Item ID / treatment slug (e.g., `weight-loss`) |
| `data-ecommerce-name` | Yes | Display name (e.g., `Weight Loss`) |
| `data-ecommerce-price` | Yes | Price as string (e.g., `60`) |
| `data-ecommerce-category` | No | Defaults to `Telehealth` |
| `data-ecommerce-brand` | No | Defaults to `PocketPills` |
| `data-ecommerce-variant` | No | Optional variant |
| `data-ecommerce-discount` | No | Optional discount amount |
| `data-ecommerce-coupon` | No | Optional coupon code |

### How It Works

- **Page load**: The module scans all `[data-ecommerce-item]` elements and fires a single `view_item` event with all items
- **CTA click**: When a `[data-event-source="add_to_cart"]` element is clicked, the module resolves item data (from the CTA itself or nearest ancestor) and fires `add_to_cart`
- Both events are sent to GTM (`dataLayer`) and Mixpanel
- Previous ecommerce data is cleared before each push (GA4 best practice)

### Container Pattern

Attributes on a parent element, CTA button nested inside:

```html
<section data-ecommerce-item="weight-loss"
         data-ecommerce-name="Weight Loss"
         data-ecommerce-price="60">
  <h2>Weight Loss Program</h2>
  <p>$60/month assessment</p>
  <button data-event-source="add_to_cart">Start Assessment</button>
</section>
```

### Flat Pattern

All attributes directly on the CTA:

```html
<button data-event-source="add_to_cart"
        data-ecommerce-item="weight-loss"
        data-ecommerce-name="Weight Loss"
        data-ecommerce-price="60">
  Start Assessment
</button>
```

### Per-Treatment Examples

**Weight Loss** (`/telehealth/weight-loss-medication`):

```html
<section data-ecommerce-item="weight-loss"
         data-ecommerce-name="Weight Loss"
         data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start your transformation</button>
</section>
```

**Hair Loss** (`/treatment/hair-loss-treatment`):

```html
<section data-ecommerce-item="hair-loss"
         data-ecommerce-name="Hair Loss"
         data-ecommerce-price="30">
  <button data-event-source="add_to_cart">Start hair loss treatment</button>
</section>
```

**Erectile Dysfunction** (`/treatment/erectile-dysfunction-treatment`):

```html
<section data-ecommerce-item="erectile-dysfunction"
         data-ecommerce-name="Erectile Dysfunction"
         data-ecommerce-price="25">
  <button data-event-source="add_to_cart">Start ED treatment</button>
</section>
```

### Multiple Items on One Page

If a page has multiple `[data-ecommerce-item]` elements, the `view_item` event includes all of them:

```html
<div data-ecommerce-item="weight-loss"
     data-ecommerce-name="Weight Loss"
     data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start Weight Loss</button>
</div>

<div data-ecommerce-item="hair-loss"
     data-ecommerce-name="Hair Loss"
     data-ecommerce-price="30">
  <button data-event-source="add_to_cart">Start Hair Loss</button>
</div>
```

On load, one `view_item` fires with both items. Clicking a CTA fires `add_to_cart` with only that item.

### Optional Configuration

Override defaults if needed (not required for standard usage):

```html
<script>
  document.addEventListener('DOMContentLoaded', function() {
    if (window.ppLib && window.ppLib.ecommerce) {
      ppLib.ecommerce.configure({
        defaults: {
          brand: 'CustomBrand',
          category: 'CustomCategory',
          currency: 'USD'
        }
      });
    }
  });
</script>
```

### Migration from Inline Scripts

Replace per-page inline `<script>` blocks with data attributes:

**Before** (inline script per page):
```html
<button data-event-source="add_to_cart">Start Assessment</button>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    var treatmentId = 'weight-loss';
    // ... 30+ lines of JS per page
  });
</script>
```

**After** (data attributes only):
```html
<section data-ecommerce-item="weight-loss"
         data-ecommerce-name="Weight Loss"
         data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start Assessment</button>
</section>
```

Zero JavaScript per page. The `ecommerce.js` module handles everything.

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

### `window.ppLib.ecommerce`

- `ppLib.ecommerce.configure(options)` — Override defaults (brand, category, currency, attribute names)
- `ppLib.ecommerce.trackViewItem()` — Re-fire `view_item` by re-scanning the DOM (useful after dynamic content)
- `ppLib.ecommerce.trackItem(itemData)` — Programmatically fire `add_to_cart` for a given item
- `ppLib.ecommerce.getItems()` — Return parsed items currently in the DOM
- `ppLib.ecommerce.getConfig()` — Return current config

### `window.ppLib.mixpanel`

- `ppLib.mixpanel.configure(options)` — Set token, project name, etc.
- `ppLib.mixpanel.init()` — Initialize Mixpanel SDK

## Browser Support

Modern browsers (Chrome, Firefox, Safari, Edge). IE11 is not supported.
