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

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging
- **GTM** (`window.dataLayer`) — Created if not present
- **Mixpanel** (`window.mixpanel`) — Optional; events are sent if available
