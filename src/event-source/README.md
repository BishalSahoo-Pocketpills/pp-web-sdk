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
  element_href: '',                   // href for anchor elements (empty string for non-links)
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

## Architecture & Design Decisions

### Event Delegation vs. Per-Element Listeners

The module uses a single `document`-level listener instead of attaching listeners to each `[data-event-source]` element:

```typescript
doc.addEventListener('click', handleInteraction, { capture: false, passive: true });
```

**Why:**
- **Dynamic elements** — Elements added after DOMContentLoaded (Webflow interactions, JS rendering) are automatically tracked
- **Memory efficiency** — One listener regardless of how many trackable elements exist
- **No MutationObserver needed** — No need to watch for DOM changes and rebind

**Tradeoff:** Every click event bubbles through the handler. The `target.closest('[data-event-source]')` check short-circuits immediately for non-tracked clicks, so the overhead is negligible.

### Debounce by Element Identity

Events are debounced per element using a composite key:

```typescript
function getElementId(el) {
  return el.tagName + ':' + el.getAttribute('data-event-source') + ':' + el.innerText.substring(0, 50);
}
```

**Why:** On mobile, a single tap fires both `touchend` and `click` events. Without debouncing, every tap would produce duplicate analytics events.

**Tradeoff:** The 300ms debounce window means legitimate double-clicks within 300ms are deduplicated. This is acceptable for analytics tracking where the first click is the meaningful signal.

### Passive Event Listeners

```typescript
{ capture: false, passive: true }
```

**Why:** `passive: true` tells the browser the handler won't call `preventDefault()`, allowing the browser to optimize scroll and touch performance. Since this is analytics tracking (not behavior modification), there's no need to prevent default actions.

### Element Context Enrichment

Every event includes the element's tag name, truncated text content (100 chars), and href (for links):

```typescript
data.element_tag = el.tagName.toLowerCase();
data.element_text = ppLib.Security.sanitize(el.innerText.substring(0, 100).trim());
data.element_href = el.href; // only for <a> tags
```

**Why:** Context helps marketing teams identify which specific button was clicked without needing unique `data-event-source` values for every element. The 100-character truncation prevents excessively large payloads.

---

## Validation & Fallbacks

The event source module validates all inputs and silently handles missing or invalid data.

### Event Data Extraction Validation

| Attribute | Required | Fallback | Warning Logged |
|---|---|---|---|
| `data-event-source` | Yes | - | Returns `null` (element skipped, no event dispatched) |
| `data-event-category` | No | Not included in payload | No warning |
| `data-event-label` | No | Not included in payload | No warning |
| `data-event-value` | No | Not included in payload | No warning |
| `element_href` | Auto-detected | `''` (empty string) for non-`<a>` elements | No warning |
| `element_text` | Auto-extracted | Truncated to 100 chars, trimmed | No warning |
| `interaction_type` | Auto-set | From `Event.type` (`'click'` or `'touchend'`) | No warning |

### Input Sanitization

All extracted attribute values pass through `ppLib.Security.sanitize()`. If sanitization returns an empty string for the `data-event-source` value, the entire event is skipped.

### Public API Validation

| Method | Validation | Warning Logged |
|---|---|---|
| `trackElement(element)` | `element` must not be null/undefined | `'trackElement called with null/undefined element'` (warn) |
| `trackElement(element)` | Element must have `data-event-source` | No event dispatched (silent) |
| `trackCustom(eventSource)` | `eventSource` must be non-empty | `'trackCustom requires a non-empty eventSource'` (warn) |
| `trackCustom(eventSource)` | `eventSource` must survive sanitization | `'trackCustom: eventSource was rejected by sanitization'` (warn) |
| `trackCustom(_, properties)` | Properties must be an object | Non-object properties are ignored |

### Dispatch Fallbacks

| Condition | Behavior |
|---|---|
| `CONFIG.platforms.mixpanel.enabled` is `false` | `sendToMixpanel()` is a no-op |
| `CONFIG.platforms.gtm.enabled` is `false` | `sendToGTM()` is a no-op |
| `window.mixpanel` not available | `sendToMixpanel()` silently returns |
| `CONFIG.includePageContext` is `false` | Page URL, path, and title are not included in event data |

### Debounce Behavior

| Condition | Behavior |
|---|---|
| Same element clicked/tapped within 300ms | Duplicate event suppressed (no warning logged) |
| Element identity | Composite key: `tagName:eventSource:innerText(50 chars)` |
| `trackCustom()` calls | Not debounced (each call dispatches immediately) |

---

## Known Limitations

1. **No event batching** — Each click dispatches immediately to GTM and Mixpanel. For high-traffic pages with many tracked elements, this could create burst traffic. The analytics module's event queue is not shared with event-source.

2. **GTM/Mixpanel dispatch is independent** — The event-source module dispatches directly to `window.dataLayer` and `window.mixpanel.track()`, not through the analytics module's event queue. This means rate limiting and `requestIdleCallback` scheduling don't apply.

3. **`element_text` uses `innerText`** — This triggers layout computation on each extraction. For analytics purposes the performance impact is negligible, but `textContent` would be technically faster.

---

## Dependencies

- **common** (`window.ppLib`) — Security (sanitize), logging, extend
- **GTM** (`window.dataLayer`) — Created if not present
- **Mixpanel** (`window.mixpanel`) — Optional; events sent if available
