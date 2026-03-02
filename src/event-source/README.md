# Event Source Module

Auto-tracks clicks and taps on interactive elements marked with `data-event-source`. Dispatches events to GTM and Mixpanel with element context and page metadata.

**Output:** `event-source.min.js` | **Global:** `ppLib.eventSource`

---

## Overview

The event source module uses event delegation on `document` to capture clicks and `touchend` events on any element with a `data-event-source` attribute. Each interaction is enriched with element context (tag, text, href) and page metadata (URL, path, title), then dispatched to GTM and Mixpanel.

No per-element event listeners are needed — add the attribute to any element and it's automatically tracked.

---

## Source Files

| File | Purpose |
|---|---|
| `index.ts` | Single-file module — config, event delegation, context extraction, dispatch |

---

## Quick Start

```html
<script src="common.min.js"></script>
<script src="event-source.min.js"></script>

<!-- Clicks are auto-tracked -->
<button data-event-source="signup_cta">Sign Up</button>
<a href="/pricing" data-event-source="pricing_link">View Pricing</a>
```

The module auto-initializes on `DOMContentLoaded`. No configuration required.

---

## Data Attributes

| Attribute | Required | Description |
|---|---|---|
| `data-event-source` | Yes | Event identifier (e.g., `signup_cta`, `pricing_link`) |
| `data-event-category` | No | Event category for grouping |
| `data-event-label` | No | Descriptive label |
| `data-event-value` | No | Numeric value (e.g., price) |

### Examples

Basic click tracking:

```html
<button data-event-source="signup_cta">Sign Up</button>
```

Rich event data:

```html
<button data-event-source="add_to_cart"
        data-event-category="ecommerce"
        data-event-label="Product Page CTA"
        data-event-value="49.99">
  Add to Cart
</button>
```

Link tracking:

```html
<a href="/pricing"
   data-event-source="pricing_link"
   data-event-category="navigation">
  View Pricing
</a>
```

---

## Configuration

```javascript
ppLib.eventSource.configure({
  attribute: 'data-event-source',         // Main attribute to scan
  categoryAttribute: 'data-event-category',
  labelAttribute: 'data-event-label',
  valueAttribute: 'data-event-value',
  gtmEventName: 'element_click',          // GTM dataLayer event name
  mixpanelEventName: 'Element Click'      // Mixpanel event name
});
```

---

## API Reference

### `ppLib.eventSource.configure(options)`

Override default configuration. Accepts `Partial<EventSourceConfig>`.

### `ppLib.eventSource.init()`

Manually initialize the event listener. Called automatically on `DOMContentLoaded`.

### `ppLib.eventSource.trackElement(element)`

Programmatically track a specific DOM element as if it were clicked:

```javascript
var btn = document.getElementById('my-button');
ppLib.eventSource.trackElement(btn);
```

### `ppLib.eventSource.trackCustom(eventSource, properties)`

Track a custom event without a DOM element:

```javascript
ppLib.eventSource.trackCustom('video_played', {
  video_id: 'intro-video',
  duration: 120
});
```

### `ppLib.eventSource.getConfig()`

Returns the current configuration object.

---

## Event Output

### Payload Structure

Each tracked interaction generates an event with:

```javascript
{
  event_source: 'signup_cta',        // from data-event-source
  event_category: 'conversion',      // from data-event-category (optional)
  event_label: 'Hero CTA',           // from data-event-label (optional)
  event_value: '49.99',              // from data-event-value (optional)
  element_tag: 'BUTTON',             // HTML tag name
  element_text: 'Sign Up',           // trimmed text content
  element_href: null,                // href for anchor elements
  page_url: 'https://...',           // current page URL
  page_path: '/pricing',             // pathname
  page_title: 'Pricing'              // document title
}
```

### GTM

```javascript
window.dataLayer.push({
  event: 'element_click',
  event_source: 'signup_cta',
  // ... all properties above
});
```

### Mixpanel

```javascript
window.mixpanel.track('Element Click', {
  event_source: 'signup_cta',
  // ... all properties above
});
```

---

## Debouncing

Click and `touchend` events on the same element are debounced with a 300ms window. This prevents duplicate events on mobile devices where both `touchend` and `click` fire for the same tap.

---

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging
- **GTM** (`window.dataLayer`) — Created if not present
- **Mixpanel** (`window.mixpanel`) — Optional; events sent if available
