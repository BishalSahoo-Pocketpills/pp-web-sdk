import type { PPLib } from '../types/common.types';
import type { BrazeConfig } from '../types/braze.types';

export function createEventHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  const lastEventMap: Record<string, number> = {};
  var debounceWriteCount = 0;

  function isDuplicate(key: string): boolean {
    var now = Date.now();
    /*! v8 ignore start */
    // Prune stale entries every 100 writes to prevent unbounded growth
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (var k in lastEventMap) {
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
    var eventName = el.getAttribute(CONFIG.event.eventAttribute) || '';
    /*! v8 ignore start */
    var tag = (el as any).tagName || '';
    /*! v8 ignore stop */
    var text = ((el as any).innerText || '').substring(0, 50).trim();
    return tag + ':' + eventName + ':' + text;
  }

  function extractProps(el: Element): Record<string, string> {
    var props: Record<string, string> = {};
    var attrs = el.attributes;

    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      /*! v8 ignore start */
      if (attr.name.indexOf(CONFIG.event.propPrefix) === 0) {
      /*! v8 ignore stop */
        var propName = attr.name.substring(CONFIG.event.propPrefix.length);
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
      var target = e.target as Element;
      var el = target.closest('[' + CONFIG.event.eventAttribute + ']');

      /*! v8 ignore start */
      if (!el) return;
      /*! v8 ignore stop */

      var eventName = el.getAttribute(CONFIG.event.eventAttribute);
      /*! v8 ignore start */
      if (!eventName) {
        ppLib.log('warn', '[ppBraze] Element found with [' + CONFIG.event.eventAttribute + '] but attribute value is empty');
        return;
      }
      /*! v8 ignore stop */

      var sanitizedName = ppLib.Security.sanitize(eventName);
      /*! v8 ignore start */
      if (!sanitizedName) {
        ppLib.log('warn', '[ppBraze] Event name was rejected by sanitization: ' + eventName);
        return;
      }
      /*! v8 ignore stop */

      // Debounce
      var key = getElementKey(el);
      /*! v8 ignore start */
      if (isDuplicate(key)) return;
      /*! v8 ignore stop */

      // Extract dynamic properties
      var properties = extractProps(el);

      // Add page context
      /*! v8 ignore start */
      if (CONFIG.event.includePageContext) {
      /*! v8 ignore stop */
        properties.page_url = win.location.href;
        properties.page_path = win.location.pathname;
        properties.page_title = doc.title;
      }

      win.braze.logCustomEvent(sanitizedName, properties);
      ppLib.log('info', '[ppBraze] Event tracked → ' + sanitizedName, properties);
    } catch (err) {
      ppLib.log('error', '[ppBraze] handleInteraction error', err);
    }
  }

  function bind(): void {
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
