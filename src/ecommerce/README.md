# Ecommerce Module

Data-attribute-driven GA4 ecommerce event tracking. Fires `view_item` on page load and `add_to_cart` on CTA clicks — no inline JavaScript required.

**Output:** `ecommerce.min.js` | **Global:** `ppLib.ecommerce`

---

## Overview

The ecommerce module scans the DOM for elements with `data-ecommerce-*` attributes, builds GA4-standard item payloads, and dispatches events to both GTM (`window.dataLayer`) and Mixpanel.

**Behavior:**

1. **On page load** — Scans all `[data-ecommerce-item]` elements, builds an items array, fires a single `view_item` event
2. **On CTA click** — When a `[data-event-source="add_to_cart"]` element is clicked, resolves the associated item data and fires `add_to_cart`
3. Previous ecommerce data in the dataLayer is cleared before each push (GA4 best practice)

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Single-file module — config, DOM scanning, event delegation, GTM/Mixpanel dispatch |

---

## Quick Start

```html
<script src="common.min.js"></script>
<script src="ecommerce.min.js"></script>

<!-- Items are auto-detected and view_item fires on load -->
<section data-ecommerce-item="weight-loss"
         data-ecommerce-name="Weight Loss"
         data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start Assessment</button>
</section>
```

---

## Data Attributes

| Attribute | Required | Default | Description |
|---|---|---|---|
| `data-ecommerce-item` | Yes | — | Item ID / product slug (e.g., `weight-loss`) |
| `data-ecommerce-name` | Yes | — | Display name (e.g., `Weight Loss`) |
| `data-ecommerce-price` | Yes | — | Price as string (e.g., `60`) |
| `data-ecommerce-category` | No | `Telehealth` | Product category |
| `data-ecommerce-brand` | No | `PocketPills` | Brand name |
| `data-ecommerce-variant` | No | — | Product variant |
| `data-ecommerce-discount` | No | — | Discount amount |
| `data-ecommerce-coupon` | No | — | Coupon code |

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

When the CTA is clicked, the module walks up the DOM tree to find the nearest ancestor with `data-ecommerce-item`.

### Flat Pattern

All attributes on the CTA element itself:

```html
<button data-event-source="add_to_cart"
        data-ecommerce-item="weight-loss"
        data-ecommerce-name="Weight Loss"
        data-ecommerce-price="60">
  Start Assessment
</button>
```

### Multiple Items

If a page has multiple `[data-ecommerce-item]` elements, the `view_item` event includes all of them. Each CTA click fires `add_to_cart` with only its associated item.

```html
<div data-ecommerce-item="weight-loss" data-ecommerce-name="Weight Loss" data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start Weight Loss</button>
</div>
<div data-ecommerce-item="hair-loss" data-ecommerce-name="Hair Loss" data-ecommerce-price="30">
  <button data-event-source="add_to_cart">Start Hair Loss</button>
</div>
```

---

## Configuration

```javascript
ppLib.ecommerce.configure({
  defaults: {
    brand: 'PocketPills',      // Default brand for all items
    category: 'Telehealth',    // Default category
    currency: 'CAD',           // Currency code
    quantity: 1                // Default quantity
  }
});
```

---

## API Reference

### `ppLib.ecommerce.configure(options)`

Override default configuration. Accepts `Partial<EcommerceConfig>`.

### `ppLib.ecommerce.trackViewItem()`

Re-scan the DOM and fire a new `view_item` event. Useful after dynamically adding product elements.

### `ppLib.ecommerce.trackItem(itemData)`

Programmatically fire an `add_to_cart` event with custom item data:

```javascript
ppLib.ecommerce.trackItem({
  item_id: 'weight-loss',
  item_name: 'Weight Loss',
  price: 60,
  currency: 'CAD'
});
```

### `ppLib.ecommerce.getItems()`

Returns all ecommerce items currently found in the DOM as parsed objects.

### `ppLib.ecommerce.getConfig()`

Returns the current configuration object.

---

## Event Output

### GTM (dataLayer)

```javascript
// view_item
window.dataLayer.push({
  event: 'view_item',
  ecommerce: {
    currency: 'CAD',
    items: [{ item_id: 'weight-loss', item_name: 'Weight Loss', price: 60, ... }]
  }
});

// add_to_cart
window.dataLayer.push({
  event: 'add_to_cart',
  ecommerce: {
    currency: 'CAD',
    items: [{ item_id: 'weight-loss', item_name: 'Weight Loss', price: 60, ... }]
  }
});
```

Previous `ecommerce` data is cleared (`{ ecommerce: null }`) before each push.

### Mixpanel

Same event names (`view_item`, `add_to_cart`) with flattened item properties.

---

## Debouncing

Click and `touchend` events on the same element are debounced with a 300ms window to prevent duplicate `add_to_cart` fires on mobile devices.

---

## Architecture & Design Decisions

### Event Delegation Pattern

A single `click` and `touchend` listener on `document` handles all CTA interactions:

```typescript
doc.addEventListener('click', handleInteraction, { capture: false, passive: true });
doc.addEventListener('touchend', handleInteraction, { capture: false, passive: true });
```

**Why:** Element delegation means dynamically added product cards (e.g., via JS frameworks or Webflow interactions) are automatically tracked without re-binding listeners.

**Tradeoff:** Every click on the page passes through the handler, though `target.closest(CONFIG.ctaSelector)` short-circuits immediately for non-CTA clicks.

### Container/Flat Resolution Pattern

When a CTA is clicked, the module tries two strategies to find item data:

1. **Flat pattern** — Check if the CTA element itself has `data-ecommerce-item`
2. **Container pattern** — Walk up the DOM via `closest('[data-ecommerce-item]')` to find a parent with the attribute

```html
<!-- Container: attributes on parent, CTA nested -->
<section data-ecommerce-item="weight-loss" data-ecommerce-name="Weight Loss" data-ecommerce-price="60">
  <button data-event-source="add_to_cart">Start</button>
</section>

<!-- Flat: all attributes directly on CTA -->
<button data-event-source="add_to_cart" data-ecommerce-item="weight-loss" ...>Start</button>
```

**Why:** The container pattern matches typical Webflow page structure (product cards with nested CTAs). The flat pattern supports simple cases.

**Tradeoff:** If nested product cards exist (card inside card), `closest()` returns the nearest ancestor, which may not always be the intended parent.

### Deferred `view_item` to Window Load

```typescript
if (doc.readyState === 'complete') {
  trackViewItem();
} else {
  win.addEventListener('load', trackViewItem);
}
```

**Why:** Defers `view_item` to `window.load` (not `DOMContentLoaded`) so that Mixpanel SDK and GTM have time to fully initialize. The ecommerce module initializes on `DOMContentLoaded`, but the actual event dispatch waits for `load`.

**Tradeoff:** On slow pages, there could be a visible delay between page render and `view_item` firing. This is acceptable since the event is for analytics, not user-visible behavior.

### GTM `ecommerce: null` Clear Pattern

Before each dataLayer push, previous ecommerce data is cleared:

```typescript
win.dataLayer.push({ ecommerce: null });
win.dataLayer.push({ event: eventName, ecommerce: ecommerceData });
```

**Why:** GA4 best practice. Without the `null` clear, subsequent ecommerce events can merge with stale data from previous pushes, causing inflated item counts or incorrect values.

---

## Validation & Fallbacks

The ecommerce module validates all data attributes and falls back to configured defaults when optional fields are missing.

### Item Data Validation

| Attribute | Required | Fallback Value | Warning Logged |
|---|---|---|---|
| `data-ecommerce-item` | Yes | - | `'Missing required ecommerce attribute(s): data-ecommerce-item'` (warn) |
| `data-ecommerce-name` | Yes | - | `'Missing required ecommerce attribute(s): data-ecommerce-name'` (warn) |
| `data-ecommerce-price` | Yes | - | `'Missing required ecommerce attribute(s): data-ecommerce-price'` (warn) |
| `data-ecommerce-brand` | No | `CONFIG.defaults.brand` (`'PocketPills'`) | No warning |
| `data-ecommerce-category` | No | `CONFIG.defaults.category` (`'Telehealth'`) | No warning |
| `data-ecommerce-variant` | No | Not included in payload | No warning |
| `data-ecommerce-discount` | No | Not included in payload | No warning |
| `data-ecommerce-coupon` | No | Not included in payload | No warning |

When any of the three required attributes is missing, the `parseItem()` function returns `null` and logs a single warning listing all missing attributes. The warning is specific and actionable:

```
[ppEcommerce] Missing required ecommerce attribute(s): data-ecommerce-item data-ecommerce-price
```

### Input Sanitization

All attribute values pass through `ppLib.Security.sanitize()` before being included in event payloads. This applies to both DOM-extracted and programmatically provided values.

### Event Dispatch Fallbacks

| Condition | Behavior |
|---|---|
| No `[data-ecommerce-item]` elements on page | `'No ecommerce items found on page'` logged (verbose), no `view_item` fired |
| CTA clicked but no ecommerce data found | `'CTA clicked but no ecommerce data found'` logged (verbose), no `add_to_cart` fired |
| `buildEcommerceData()` receives empty items | Returns `null`, event not dispatched |
| Price is `NaN` after `parseFloat()` | Item's price contribution to total is `0` |
| `window.mixpanel` not available | `sendToMixpanel()` silently returns |

### Programmatic API Validation

| Method | Validation | Warning/Error Logged |
|---|---|---|
| `trackItem(itemData)` | Requires `item_id`, `item_name`, and `price` | `'trackItem requires item_id, item_name, and price'` (error) |
| `trackItem(itemData)` | Missing `item_brand` | Falls back to `CONFIG.defaults.brand` |
| `trackItem(itemData)` | Missing `item_category` | Falls back to `CONFIG.defaults.category` |
| `trackItem(itemData)` | Missing `quantity` | Falls back to `CONFIG.defaults.quantity` (`1`) |

### Debounce Behavior

| Condition | Behavior |
|---|---|
| Same element clicked/tapped within 300ms | Duplicate event suppressed (no warning logged) |
| Element identity | Composite key: `tagName:itemId:innerText(50 chars)` |

---

## Known Limitations

1. **Price is sent as string in item data** — `price: ppLib.Security.sanitize(itemPrice)` returns a string. GA4 technically expects a number in the `items` array. GTM coerces it, but strict GA4 validation may flag it.

2. **CTA selector is hardcoded to `[data-event-source="add_to_cart"]`** — The ecommerce module is coupled to the event-source module's attribute naming. Configurable via `ctaSelector` in config, but the default creates an implicit dependency.

3. **No `purchase` event** — The module only tracks `view_item` and `add_to_cart`. Full GA4 ecommerce flow (`begin_checkout`, `purchase`) requires the braze module's purchase tracking or custom implementation.

---

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging, extend
- **GTM** (`window.dataLayer`) — Created if not present
- **Mixpanel** (`window.mixpanel`) — Optional; events are sent if available
- **event-source** (implicit) — Default CTA selector uses `data-event-source` attribute
