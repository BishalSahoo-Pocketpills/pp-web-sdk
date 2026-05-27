/**
 * Build a stable debounce key from an element's tag, a data-attribute
 * value, and its text content (truncated to 50 chars). Used by
 * ecommerce, event-source, braze/events, and datalayer/dom to
 * deduplicate interaction events on the same element.
 */
export function getElementDebounceKey(el: Element, attribute: string): string {
  const tag = el.tagName || '';
  const text = (el.textContent || '').substring(0, 50).trim();
  return tag + ':' + attribute + ':' + text;
}
