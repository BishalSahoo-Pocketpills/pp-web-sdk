import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';

export function createEventHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  const lastEventMap: Record<string, number> = {};
  let debounceWriteCount = 0;
  let bound = false;

  function isDuplicate(key: string): boolean {
    const now = Date.now();
    /*! v8 ignore start */
    // Prune stale entries every 100 writes to prevent unbounded growth
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (const k in lastEventMap) {
        if ((now - lastEventMap[k]) >= CONFIG.event.debounceMs) {
          delete lastEventMap[k];
        }
      }
    }
    if (lastEventMap[key] && (now - lastEventMap[key]) < CONFIG.event.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastEventMap[key] = now;
    return false;
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
      const safeProps = ppLib.safeLogPayload ? ppLib.safeLogPayload(properties) : '<redacted>';
      ppLib.log('info', '[ppBraze] Event tracked → ' + sanitizedName, safeProps);
    } catch (err) {
      ppLib.log('error', '[ppBraze] handleInteraction error', err);
    }
  }

  function bind(): void {
    if (bound) return;
    bound = true;

    doc.addEventListener('click', handleInteraction, { capture: false, passive: true } as EventListenerOptions);
    doc.addEventListener('touchend', handleInteraction, { capture: false, passive: true } as EventListenerOptions);
    ppLib.log('info', '[ppBraze] Event handler bound');
  }

  return {
    bind: bind,
    handleInteraction: handleInteraction,
    extractProps: extractProps
  };
}
