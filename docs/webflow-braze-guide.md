# Braze Integration — Webflow Designer Guide

This guide walks you through adding PocketPills Braze tracking to a Webflow site using data attributes. No coding experience required — just copy-paste snippets and set attributes in the Webflow Designer.

---

## Table of Contents

1. [Setup — Adding Scripts](#1-setup--adding-scripts)
2. [Configuration — API Key & Init](#2-configuration--api-key--init)
3. [Forms — Lead Capture & Contact](#3-forms--lead-capture--contact)
4. [Event Buttons — CTA Tracking](#4-event-buttons--cta-tracking)
5. [Purchase Buttons — Product Tracking](#5-purchase-buttons--product-tracking)
6. [Testing — Verify It Works](#6-testing--verify-it-works)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Setup — Adding Scripts

Add these two scripts to your Webflow site's **custom code** (site-level, not page-level):

**Settings → Custom Code → Head Code** (or Footer Code):

```html
<script src="https://your-cdn.com/common.min.js"></script>
<script src="https://your-cdn.com/braze.min.js"></script>
```

> Replace `https://your-cdn.com/` with the actual CDN URL where the SDK files are hosted.

These scripts must load on **every page** where you want Braze tracking. Site-level custom code ensures this.

---

## 2. Configuration — API Key & Init

Add a configuration script **after** the two SDK scripts. This goes in **Settings → Custom Code → Footer Code**:

```html
<script>
  ppLib.braze.configure({
    sdk: {
      apiKey: 'YOUR_BRAZE_API_KEY',
      baseUrl: 'sdk.iad-01.braze.com'
    }
  });
  ppLib.braze.init();
</script>
```

| Setting | What it is | Example |
|---------|-----------|---------|
| `apiKey` | Your Braze REST API key (get from Braze dashboard → Settings → API Keys) | `'abc123-def456'` |
| `baseUrl` | Your Braze SDK endpoint (get from Braze dashboard → Settings → Manage Settings) | `'sdk.iad-01.braze.com'` |

---

## 3. Forms — Lead Capture & Contact

To track a Webflow form with Braze, add these data attributes in the Webflow Designer:

### Step 1: Tag the Form

Select the **Form Block** element and add a custom attribute:

```
Attribute name:   data-braze-form
Attribute value:  lead_capture
```

```
┌─────────────────────────────────────┐
│  Element Settings (Form Block)      │
│                                     │
│  Custom Attributes:                 │
│  ┌───────────────┬────────────────┐ │
│  │ data-braze-form │ lead_capture │ │
│  └───────────────┴────────────────┘ │
└─────────────────────────────────────┘
```

The value (`lead_capture`) becomes the form name in Braze events.

### Step 2: Tag Each Input Field

Select each **Input** element inside the form and add `data-braze-attr`:

| Input | Attribute Name | Attribute Value |
|-------|---------------|-----------------|
| Email | `data-braze-attr` | `email` |
| First Name | `data-braze-attr` | `first_name` |
| Last Name | `data-braze-attr` | `last_name` |
| Phone | `data-braze-attr` | `phone` |
| Custom field | `data-braze-attr` | `custom:your_field_name` |

```
┌─────────────────────────────────────┐
│  Element Settings (Email Input)     │
│                                     │
│  Custom Attributes:                 │
│  ┌───────────────┬───────────────┐  │
│  │ data-braze-attr │ email       │  │
│  └───────────────┴───────────────┘  │
└─────────────────────────────────────┘
```

**Standard attributes** (`email`, `first_name`, `last_name`, `phone`, `gender`, `dob`, `country`, `city`, `language`) map to Braze's built-in user profile fields.

**Custom attributes** use the `custom:` prefix — e.g., `custom:preferred_pharmacy` creates a custom Braze user attribute called `preferred_pharmacy`.

### Step 3: (Optional) Custom Event Name

By default, form submissions fire a Braze event called `form_submitted_<form_name>` (e.g., `form_submitted_lead_capture`).

To override the event name, add to the **Form Block**:

```
Attribute name:   data-braze-form-event
Attribute value:  your_custom_event_name
```

### What happens on submit

1. User attributes are set on the Braze user profile (email, first_name, etc.)
2. A `logCustomEvent` call fires with form name and page context
3. Data is flushed immediately (before page navigation)

---

## 4. Event Buttons — CTA Tracking

Track button clicks as Braze custom events by adding attributes to any element:

### Step 1: Tag the Element

Select a **Button**, **Link**, or **Div** and add:

```
Attribute name:   data-braze-event
Attribute value:  started_signup
```

### Step 2: (Optional) Add Event Properties

Add as many `data-braze-prop-*` attributes as needed:

```
data-braze-prop-source    →  hero_banner
data-braze-prop-plan      →  premium
data-braze-prop-variant   →  B
```

```
┌─────────────────────────────────────────┐
│  Element Settings (CTA Button)          │
│                                         │
│  Custom Attributes:                     │
│  ┌─────────────────────┬──────────────┐ │
│  │ data-braze-event    │ started_signup│ │
│  ├─────────────────────┼──────────────┤ │
│  │ data-braze-prop-source │ hero_banner│ │
│  ├─────────────────────┼──────────────┤ │
│  │ data-braze-prop-plan   │ premium   │ │
│  └─────────────────────┴──────────────┘ │
└─────────────────────────────────────────┘
```

### What happens on click

1. A `logCustomEvent` fires with the event name and all `prop-*` values
2. Page context (URL, path, title) is automatically included
3. Rapid duplicate clicks are debounced (300ms window)

---

## 5. Purchase Buttons — Product Tracking

Track purchase intent on any clickable element:

### Add These Attributes

| Attribute | Required | Description | Example |
|-----------|----------|-------------|---------|
| `data-braze-purchase` | Yes | Product ID | `assessment-pkg` |
| `data-braze-price` | Yes | Price (number) | `60` |
| `data-braze-currency` | No | Currency code (default: `CAD`) | `CAD` |
| `data-braze-quantity` | No | Quantity (default: `1`) | `2` |

```
┌─────────────────────────────────────────────┐
│  Element Settings (Buy Button)              │
│                                             │
│  Custom Attributes:                         │
│  ┌──────────────────────┬──────────────────┐│
│  │ data-braze-purchase  │ assessment-pkg   ││
│  ├──────────────────────┼──────────────────┤│
│  │ data-braze-price     │ 60               ││
│  ├──────────────────────┼──────────────────┤│
│  │ data-braze-currency  │ CAD              ││
│  ├──────────────────────┼──────────────────┤│
│  │ data-braze-quantity  │ 2                ││
│  └──────────────────────┴──────────────────┘│
└─────────────────────────────────────────────┘
```

### What happens on click

1. A `logPurchase` call fires with product ID, price, currency, and quantity
2. Rapid duplicate clicks are debounced

---

## 6. Testing — Verify It Works

### Quick Console Check

Open your browser's DevTools console (F12 or Cmd+Opt+I) and run:

```javascript
// Is the SDK loaded?
ppLib.braze.isReady()
// → should return: true

// View current config
ppLib.braze.getConfig()
// → should show your apiKey and baseUrl

// Test manual event
ppLib.braze.trackEvent('test_event', { source: 'devtools' })

// Test manual identify
ppLib.braze.identify('test-user-123')
```

### Verify Form Tracking

1. Fill out a form on your site
2. Check the Braze dashboard → User Search → find the user by email
3. Confirm the custom event and user attributes appear

### Verify Event/Purchase Tracking

1. Click a tracked button
2. Check Braze dashboard → Custom Events or Purchases
3. Confirm the event name and properties appear

---

## 7. Troubleshooting

### Scripts not loading

- Ensure `common.min.js` loads **before** `braze.min.js`
- Check the browser console for 404 errors on the script URLs
- Verify the CDN URL is correct

### `ppLib.braze.isReady()` returns `false`

- The Braze SDK may be blocked by an ad blocker — test in an incognito window with extensions disabled
- Check console for `[ppBraze] Failed to load SDK` error
- Verify `apiKey` and `baseUrl` are set before calling `init()`

### Form not tracking

- Confirm `data-braze-form` is on the **Form Block** element, not the form wrapper div
- Confirm `data-braze-attr` is on each **Input** element, not a wrapper
- Check that input values are not empty when submitted

### Wrong attribute names

Braze attributes are **exact strings**. Common mistakes:

| Wrong | Correct |
|-------|---------|
| `data-braze-attr="firstName"` | `data-braze-attr="first_name"` |
| `data-braze-attr="Email"` | `data-braze-attr="email"` |
| `data-braze-attr="customField"` | `data-braze-attr="custom:field_name"` |

### Events not appearing in Braze

- Events may take a few minutes to appear in the Braze dashboard
- Use `ppLib.braze.flush()` in the console to force an immediate data flush
- Confirm consent is not blocking: check `getConfig().consent.required`

---

## Attribute Reference

### Form Attributes

| Attribute | Where | Value |
|-----------|-------|-------|
| `data-braze-form` | Form Block | Form name (e.g., `lead_capture`) |
| `data-braze-attr` | Input elements | Field name (e.g., `email`, `first_name`, `custom:field`) |
| `data-braze-form-event` | Form Block (optional) | Custom event name override |

### Event Attributes

| Attribute | Where | Value |
|-----------|-------|-------|
| `data-braze-event` | Any clickable element | Event name (e.g., `started_signup`) |
| `data-braze-prop-*` | Same element | Property value (suffix becomes key) |

### Purchase Attributes

| Attribute | Where | Value |
|-----------|-------|-------|
| `data-braze-purchase` | Any clickable element | Product ID |
| `data-braze-price` | Same element | Price (number) |
| `data-braze-currency` | Same element (optional) | Currency code (default: `CAD`) |
| `data-braze-quantity` | Same element (optional) | Quantity (default: `1`) |
