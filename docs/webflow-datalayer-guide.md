# DataLayer Integration — Webflow Designer Guide

This guide walks you through adding PocketPills GTM DataLayer tracking to a Webflow site using data attributes. No coding experience required — just set attributes in the Webflow Designer.

---

## Table of Contents

1. [Setup — Adding Scripts](#1-setup--adding-scripts)
2. [Configuration](#2-configuration)
3. [Core Events — Pageview, Login, Signup, Search](#3-core-events--pageview-login-signup-search)
4. [Ecommerce Events — View Item, Add to Cart, Purchase](#4-ecommerce-events--view-item-add-to-cart-purchase)
5. [Link Tracking — Anchor hitCallback](#5-link-tracking--anchor-hitcallback)
6. [Testing — Verify It Works](#6-testing--verify-it-works)
7. [Troubleshooting](#7-troubleshooting)
8. [Attribute Reference](#8-attribute-reference)

---

## 1. Setup — Adding Scripts

Add these two scripts to your Webflow site's **custom code** (site-level, not page-level):

**Settings > Custom Code > Head Code** (or Footer Code):

```html
<script src="https://your-cdn.com/common.min.js"></script>
<script src="https://your-cdn.com/datalayer.min.js"></script>
```

> Replace `https://your-cdn.com/` with the actual CDN URL where the SDK files are hosted.

These scripts must load on **every page** where you want DataLayer tracking. Site-level custom code ensures this.

The module auto-initializes on page load. No additional JavaScript setup is required for basic tracking.

---

## 2. Configuration

The module works with zero configuration using sensible defaults. To customize, add a configuration script **after** the SDK scripts in **Settings > Custom Code > Footer Code**:

```html
<script>
  ppLib.ready(function() {
    ppLib.datalayer.configure({
      defaults: {
        itemBrand: 'YourBrand',
        currency: 'USD',
        platform: 'web'
      }
    });

    // Optional: set user PII for enhanced conversions
    ppLib.datalayer.setUserData({
      email: 'user@example.com',
      first_name: 'John',
      last_name: 'Doe',
      city: 'Toronto',
      region: 'ON',
      country: 'CA'
    });
  });
</script>
```

| Setting | What it is | Default |
|---------|-----------|---------|
| `defaults.itemBrand` | Default brand for ecommerce items | `'Pocketpills'` |
| `defaults.currency` | Default currency code | `'CAD'` |
| `defaults.platform` | Platform identifier for pageview events | `'web'` |

---

## 3. Core Events — Pageview, Login, Signup, Search

Track core events by adding `data-dl-event` to any clickable element.

### Login View

Select a **Button** or **Link** and add:

```
Attribute name:   data-dl-event
Attribute value:  login_view
```

Add an optional method attribute:

```
Attribute name:   data-dl-method
Attribute value:  email
```

```
+-------------------------------------+
|  Element Settings (Login Button)    |
|                                     |
|  Custom Attributes:                 |
|  +-----------------+---------------+|
|  | data-dl-event   | login_view    ||
|  +-----------------+---------------+|
|  | data-dl-method  | email         ||
|  +-----------------+---------------+|
+-------------------------------------+
```

### Signup Events

```html
<!-- Signup view -->
<button data-dl-event="signup_view"
        data-dl-method="email"
        data-dl-signup-flow="onboarding">
  Create Account
</button>

<!-- Signup start (form begin) -->
<button data-dl-event="signup_start" data-dl-method="email">
  Start Signup
</button>

<!-- Signup complete -->
<button data-dl-event="signup_complete" data-dl-method="email">
  Complete Signup
</button>
```

### Search Event

```html
<button data-dl-event="search"
        data-dl-search-term="aspirin"
        data-dl-results-count="5"
        data-dl-search-type="medication">
  Search
</button>
```

### Pageview (Manual)

Pageviews can also be triggered from data attributes:

```html
<div data-dl-event="pageview" data-dl-page-type="home">
  <!-- Triggers pageview on click -->
</div>
```

> **Note:** For automatic pageviews on every page load (no click required), use the programmatic API in your footer code: `ppLib.datalayer.pageview();`

---

## 4. Ecommerce Events — View Item, Add to Cart, Purchase

Ecommerce events require item data. There are two ways to set up items.

### Flat Pattern — All Attributes on One Element

```
+---------------------------------------------+
|  Element Settings (Add to Cart Button)      |
|                                             |
|  Custom Attributes:                         |
|  +---------------------+------------------+ |
|  | data-dl-event       | add_to_cart      | |
|  +---------------------+------------------+ |
|  | data-dl-item-id     | RX-001           | |
|  +---------------------+------------------+ |
|  | data-dl-item-name   | Aspirin          | |
|  +---------------------+------------------+ |
|  | data-dl-item-price       | 12.99            | |
|  +---------------------+------------------+ |
+---------------------------------------------+
```

### Container Pattern — Item Data on Parent

When multiple buttons share the same item, put item data on a parent element:

```html
<!-- Item data on the Section/Div -->
<section data-dl-item-id="RX-001"
         data-dl-item-name="Aspirin"
         data-dl-item-price="12.99"
         data-dl-item-category="Pain Relief">

  <!-- Each button only needs the event attribute -->
  <button data-dl-event="view_item">View Details</button>
  <button data-dl-event="add_to_cart">Add to Cart</button>
</section>
```

In Webflow Designer:

```
+----------------------------------------------+
|  Element Settings (Product Section)          |
|                                              |
|  Custom Attributes:                          |
|  +---------------------+-------------------+ |
|  | data-dl-item-id     | RX-001            | |
|  +---------------------+-------------------+ |
|  | data-dl-item-name   | Aspirin           | |
|  +---------------------+-------------------+ |
|  | data-dl-item-price       | 12.99             | |
|  +---------------------+-------------------+ |
|  | data-dl-item-category    | Pain Relief       | |
|  +---------------------+-------------------+ |
+----------------------------------------------+

+---------------------------------------------+
|  Element Settings (Add to Cart Button)      |
|                                             |
|  Custom Attributes:                         |
|  +---------------------+------------------+ |
|  | data-dl-event       | add_to_cart      | |
|  +---------------------+------------------+ |
+---------------------------------------------+
```

### Purchase Event

Purchase events need a `data-dl-transaction-id`:

```html
<button data-dl-event="purchase"
        data-dl-transaction-id="TXN-001"
        data-dl-item-id="RX-001"
        data-dl-item-name="Aspirin"
        data-dl-item-price="12.99">
  Complete Purchase
</button>
```

### Ecommerce Event Names

These event names trigger ecommerce handling (with item data extraction):

| Event Name | Purpose |
|-----------|---------|
| `view_item` | User views a product |
| `add_to_cart` | User adds item to cart |
| `begin_checkout` | User starts checkout |
| `add_payment_info` | User enters payment info |
| `purchase` | Purchase completed |

Any other `data-dl-event` value is treated as a core event (no item data extraction).

---

## 5. Link Tracking — Anchor hitCallback

When `data-dl-event` is placed on an `<a>` tag with an `href`, the module intercepts the click:

1. Prevents the default navigation
2. Pushes the event to dataLayer
3. Navigates to the href after a 100ms delay

This ensures the event is captured before the browser leaves the page.

```html
<a href="/checkout"
   data-dl-event="begin_checkout"
   data-dl-item-id="RX-001"
   data-dl-item-price="12.99">
  Proceed to Checkout
</a>
```

In Webflow Designer, add the `data-dl-event` attribute to any **Link Block** or **Text Link**. The existing `href` is preserved — the module handles the rest.

---

## 6. Testing — Verify It Works

### Quick Console Check

Open your browser's DevTools console (F12 or Cmd+Opt+I) and run:

```javascript
// Is the module loaded?
ppLib.datalayer
// -> should show the API object

// View current config
ppLib.datalayer.getConfig()
// -> should show cookieNames, defaults, attributes, etc.

// Test manual pageview
ppLib.datalayer.pageview()
// -> check window.dataLayer for the event

// Inspect dataLayer
window.dataLayer
// -> should show all pushed events
```

### Verify DOM Binding

1. Click a tracked element on your page
2. Open DevTools > Console and type `window.dataLayer`
3. Find the latest event — confirm the event name and data match

### GTM Preview Mode

1. Open [GTM Preview](https://tagmanager.google.com/) and connect to your site
2. Click tracked elements
3. Verify events appear in the GTM debug panel with correct data

---

## 7. Troubleshooting

### Scripts not loading

- Ensure `common.min.js` loads **before** `datalayer.min.js`
- Check the browser console for 404 errors on the script URLs
- Verify the CDN URL is correct

### Clicks not tracked

- Confirm `data-dl-event` is set on the **clickable element** or an ancestor
- Check that the attribute value is not empty
- Look for `[ppDataLayer]` messages in the console (enable debug mode: `ppLib.config.debug = true`)

### Ecommerce items empty

- For **container pattern**, ensure item attributes (`data-dl-item-id`, `data-dl-item-price`) are on an **ancestor** of the clicked element, not a sibling
- For **flat pattern**, ensure item attributes are on the same element as `data-dl-event`

### Anchor not navigating

- If a link with `data-dl-event` doesn't navigate, check the console for errors
- The module delays navigation by 100ms — if there's a JavaScript error before `setTimeout`, navigation won't fire

### Debounce preventing events

- Rapid clicks within 300ms on the same element are deduplicated
- This is intentional to prevent duplicate tracking on mobile (touchend + click)
- If you need to track rapid interactions, use the programmatic API instead

---

## 8. Attribute Reference

### Core Event Attributes

| Attribute | Where | Value |
|-----------|-------|-------|
| `data-dl-event` | Any clickable element | Event name (e.g., `login_view`, `search`, `pageview`) |
| `data-dl-method` | Same element | Auth method (e.g., `email`, `google`) |
| `data-dl-page-type` | Same element | Page type classification |
| `data-dl-signup-flow` | Same element | Signup flow identifier |
| `data-dl-search-term` | Same element | Search query text |
| `data-dl-results-count` | Same element | Number of results (integer) |
| `data-dl-search-type` | Same element | Type of search |

### Ecommerce Attributes

| Attribute | Where | Value |
|-----------|-------|-------|
| `data-dl-item-id` | Event element or ancestor | Product ID |
| `data-dl-item-name` | Same | Product name |
| `data-dl-item-brand` | Same (optional) | Brand (default: config `itemBrand`) |
| `data-dl-item-category` | Same (optional) | Product category |
| `data-dl-item-price` | Same | Price (number) |
| `data-dl-quantity` | Same (optional) | Quantity (default: `1`) |
| `data-dl-discount` | Same (optional) | Discount amount |
| `data-dl-coupon` | Same (optional) | Coupon code |
| `data-dl-currency` | Same (optional) | Currency override (default: config `currency`) |
| `data-dl-transaction-id` | Event element | Transaction ID (for `purchase` only) |
