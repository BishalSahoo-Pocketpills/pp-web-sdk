# pp-web-sdk

Modular web SDK for analytics, attribution, login detection, event tracking, and more.

## Modules

| Module | File | Description |
|--------|------|-------------|
| **Common** | `common.js` | Shared utilities, security, storage — **load first** |
| **Analytics** | `analytics.js` | UTM/ad attribution, consent, GTM/GA4/Mixpanel event queue |
| **Mixpanel** | `mixpanel.js` | Mixpanel SDK loader, session management, campaign params |
| **Login** | `login.js` | Cookie-based auth detection, body class management, identity DOM injection |
| **Event Source** | `event-source.js` | Auto-track clicks/taps on `data-event-source` elements |

## Installation

### Script Tags (via Cloudflare Pages CDN)

```html
<!-- Load all modules with defer to preserve execution order -->
<script defer src="https://pp-web-sdk-v1.pages.dev/common.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/analytics.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/mixpanel.min.js"></script>
<script defer src="https://pp-web-sdk-v1.pages.dev/event-source.min.js"></script>
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

Control element visibility based on auth state. The `login.js` module adds classes to `<body>` automatically — pair with CSS to show/hide elements.

**Body classes applied:**

| State | Class |
|---|---|
| Logged in | `is-logged-in` |
| Logged out | `is-logged-out` |
| Signup completed | `signup-completed` |
| Returning user | `has-previous-user` |
| DOM ready | `dom-ready` |

**Required CSS** (add to your site's global styles):

```css
/* Prevent flash of unstyled content */
body:not(.dom-ready) [data-visibility] { opacity: 0; }

/* Logged-in only elements */
body.is-logged-out [data-visibility="logged-in"] { display: none !important; }

/* Logged-out only elements */
body.is-logged-in [data-visibility="logged-out"] { display: none !important; }

/* Returning user only */
body:not(.has-previous-user) [data-visibility="has-previous-user"] { display: none !important; }

/* Signup completed only */
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

For landing pages that need GA4 standard ecommerce events (`view_item`, `add_to_cart`), add an inline script per page with the treatment/product data.

### Schema

Events follow the GA4 ecommerce standard with PocketPills-specific fields:

```js
// Item schema
{
  item_id: 'weight-loss',          // treatment slug
  item_name: 'Weight Loss',        // display name
  item_brand: 'PocketPills',       // always "PocketPills"
  item_category: 'Telehealth',    // treatment category
  price: '60',                     // assessment price (string)
  quantity: 1,
  discount: '',                    // optional — promo discount amount
  coupon: ''                       // optional — promo code
}
```

### Implementation Template

Add this inline script to each treatment landing page. Change the four config values per page.

```html
<!-- Start Assessment CTA -->
<button data-event-source="add_to_cart">Start Assessment</button>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    // ---- Configure per page (change these) ----
    var treatmentId = 'weight-loss';
    var treatmentName = 'Weight Loss';
    var treatmentCategory = 'Telehealth';
    var treatmentPrice = '60';

    var ecommerceItem = {
      item_id: treatmentId,
      item_name: treatmentName,
      item_brand: 'PocketPills',
      item_category: treatmentCategory,
      price: treatmentPrice,
      quantity: 1,
      discount: '',
      coupon: ''
    };

    var ecommerceData = {
      value: treatmentPrice,
      currency: 'CAD',
      items: [ecommerceItem]
    };

    // ---- view_item: fires on page load ----
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null }); // clear previous ecommerce
    window.dataLayer.push({
      event: 'view_item',
      ecommerce: ecommerceData
    });

    if (window.mixpanel && window.mixpanel.track) {
      window.mixpanel.track('view_item', ecommerceData);
    }

    // ---- add_to_cart: fires on Start Assessment click ----
    var cartButtons = document.querySelectorAll('[data-event-source="add_to_cart"]');
    cartButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({
          event: 'add_to_cart',
          ecommerce: ecommerceData
        });

        if (window.mixpanel && window.mixpanel.track) {
          window.mixpanel.track('add_to_cart', ecommerceData);
        }
      });
    });
  });
</script>
```

### Per-Page Configuration

Change these four values per treatment page:

| Treatment | `treatmentId` | `treatmentName` | `treatmentCategory` | `treatmentPrice` | Page URL |
|---|---|---|---|---|---|
| Weight Loss | `weight-loss` | `Weight Loss` | `Telehealth` | `60` | `/telehealth/weight-loss-medication` |
| Hair Loss | `hair-loss` | `Hair Loss` | `Telehealth` | `30` | `/treatment/hair-loss-treatment` |
| Erectile Dysfunction | `erectile-dysfunction` | `Erectile Dysfunction` | `Telehealth` | `25` | `/treatment/erectile-dysfunction-treatment` |
| *Add rows as needed* | | | | | |

### Integration: Weight Loss (`/telehealth/weight-loss-medication`)

```html
<button data-event-source="add_to_cart">Start your transformation</button>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    var treatmentId = 'weight-loss';
    var treatmentName = 'Weight Loss';
    var treatmentCategory = 'Telehealth';
    var treatmentPrice = '60';

    var ecommerceItem = {
      item_id: treatmentId,
      item_name: treatmentName,
      item_brand: 'PocketPills',
      item_category: treatmentCategory,
      price: treatmentPrice,
      quantity: 1,
      discount: '',
      coupon: ''
    };

    var ecommerceData = {
      value: treatmentPrice,
      currency: 'CAD',
      items: [ecommerceItem]
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: 'view_item', ecommerce: ecommerceData });

    if (window.mixpanel && window.mixpanel.track) {
      window.mixpanel.track('view_item', ecommerceData);
    }

    var cartButtons = document.querySelectorAll('[data-event-source="add_to_cart"]');
    cartButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: 'add_to_cart', ecommerce: ecommerceData });
        if (window.mixpanel && window.mixpanel.track) {
          window.mixpanel.track('add_to_cart', ecommerceData);
        }
      });
    });
  });
</script>
```

### Integration: Hair Loss (`/treatment/hair-loss-treatment`)

```html
<button data-event-source="add_to_cart">Start hair loss treatment</button>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    var treatmentId = 'hair-loss';
    var treatmentName = 'Hair Loss';
    var treatmentCategory = 'Telehealth';
    var treatmentPrice = '30';

    var ecommerceItem = {
      item_id: treatmentId,
      item_name: treatmentName,
      item_brand: 'PocketPills',
      item_category: treatmentCategory,
      price: treatmentPrice,
      quantity: 1,
      discount: '',
      coupon: ''
    };

    var ecommerceData = {
      value: treatmentPrice,
      currency: 'CAD',
      items: [ecommerceItem]
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: 'view_item', ecommerce: ecommerceData });

    if (window.mixpanel && window.mixpanel.track) {
      window.mixpanel.track('view_item', ecommerceData);
    }

    var cartButtons = document.querySelectorAll('[data-event-source="add_to_cart"]');
    cartButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: 'add_to_cart', ecommerce: ecommerceData });
        if (window.mixpanel && window.mixpanel.track) {
          window.mixpanel.track('add_to_cart', ecommerceData);
        }
      });
    });
  });
</script>
```

### Integration: Erectile Dysfunction (`/treatment/erectile-dysfunction-treatment`)

```html
<button data-event-source="add_to_cart">Start ED treatment</button>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    var treatmentId = 'erectile-dysfunction';
    var treatmentName = 'Erectile Dysfunction';
    var treatmentCategory = 'Telehealth';
    var treatmentPrice = '25';

    var ecommerceItem = {
      item_id: treatmentId,
      item_name: treatmentName,
      item_brand: 'PocketPills',
      item_category: treatmentCategory,
      price: treatmentPrice,
      quantity: 1,
      discount: '',
      coupon: ''
    };

    var ecommerceData = {
      value: treatmentPrice,
      currency: 'CAD',
      items: [ecommerceItem]
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: 'view_item', ecommerce: ecommerceData });

    if (window.mixpanel && window.mixpanel.track) {
      window.mixpanel.track('view_item', ecommerceData);
    }

    var cartButtons = document.querySelectorAll('[data-event-source="add_to_cart"]');
    cartButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: 'add_to_cart', ecommerce: ecommerceData });
        if (window.mixpanel && window.mixpanel.track) {
          window.mixpanel.track('add_to_cart', ecommerceData);
        }
      });
    });
  });
</script>
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
