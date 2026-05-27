import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';
import { createDebounceTracker } from '@src/common/debounce';
import { addInteractionListener } from '@src/common/dom-events';
import { isConsentGranted } from '@src/common/consent-check';

export function createEventHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  const debounce = createDebounceTracker(CONFIG.event);
  let bound = false;

  function isDuplicate(key: string): boolean {
    return debounce.isDuplicate(key);
  }

  function getElementKey(el: Element): string {
    const eventName = el.getAttribute(CONFIG.event.eventAttribute) || '';
    /*! v8 ignore start */
    const tag = el.tagName || '';
    /*! v8 ignore stop */
    const text = (el.textContent || '').substring(0, 50).trim();
    return tag + ':' + eventName + ':' + text;
  }

  function extractProps(el: Element): Record<string, string> {
    const props: Record<string, string> = {};
    const attrs = el.attributes;

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      /*! v8 ignore start */
      if (attr.name.indexOf(CONFIG.event.propPrefix) === 0) {
      /*! v8 ignore stop */
        const propName = attr.name.substring(CONFIG.event.propPrefix.length);
        /*! v8 ignore start */
        if (propName) {
        /*! v8 ignore stop */
          props[propName] = ppLib.Security.sanitize(attr.value);
        }
      }
    }

    return props;
  }

  function handleInteraction(e: Event): void {
    try {
      // Consent gate — drop silently before any work (sanitization,
      // dedup, prop extraction). Braze's session-level consent fires at
      // SDK init; this handles mid-session revoke.
      if (!isConsentGranted(ppLib)) return;

      const target = e.target as Element;
      const el = target.closest('[' + CONFIG.event.eventAttribute + ']');

      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      const eventName = el.getAttribute(CONFIG.event.eventAttribute);
      /*! v8 ignore start */
      if (!eventName) {
        ppLib.log('warn', '[ppBraze] Element found with [' + CONFIG.event.eventAttribute + '] but attribute value is empty');
        return;
      }
      /*! v8 ignore stop */

      const sanitizedName = ppLib.Security.sanitize(eventName);
      /*! v8 ignore start */
      if (!sanitizedName) {
        // Drop the rejected value from the log. Custom event-source attrs
        // can carry user-typed strings; bypassing safeLogPayload here would
        // leak PII through the rejection path itself.
        ppLib.log('warn', '[ppBraze] Event name was rejected by sanitization');
        return;
      }
      /*! v8 ignore stop */

      // Debounce
      const key = getElementKey(el);
      /*! v8 ignore start */
      if (isDuplicate(key)) return;
      /*! v8 ignore stop */

      // Extract dynamic properties
      const properties = extractProps(el);

      // Add page context
      /*! v8 ignore start */
      if (CONFIG.event.includePageContext) {
      /*! v8 ignore stop */
        properties.page_url = win.location.href;
        properties.page_path = win.location.pathname;
        properties.page_title = doc.title;
      }

      win.braze.logCustomEvent(sanitizedName, properties);
      const safeProps = ppLib.safeLogPayload(properties);
      ppLib.log('info', '[ppBraze] Event tracked → ' + sanitizedName, safeProps);
    } catch (err) {
      ppLib.log('error', '[ppBraze] handleInteraction error', ppLib.safeLogError(err));
    }
  }

  function bind(): void {
    if (bound) return;
    bound = true;

    addInteractionListener(doc, handleInteraction);
    ppLib.log('info', '[ppBraze] Event handler bound');
  }

  return {
    bind: bind,
    handleInteraction: handleInteraction,
    extractProps: extractProps
  };
}
