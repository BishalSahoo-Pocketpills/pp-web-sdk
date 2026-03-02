import type { PPLib } from '../types/common.types';
import type { BrazeConfig } from '../types/braze.types';

export function createFormHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig,
  userManager: { processFormAttrs: (fieldMap: Record<string, string>) => void }
) {
  const lastSubmitMap: Record<string, number> = {};

  function isDuplicate(formName: string): boolean {
    var now = Date.now();
    /*! v8 ignore start */
    if (lastSubmitMap[formName] && (now - lastSubmitMap[formName]) < CONFIG.form.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastSubmitMap[formName] = now;
    return false;
  }

  function extractFields(form: HTMLFormElement): Record<string, string> {
    var fields: Record<string, string> = {};
    var elements = form.querySelectorAll('[' + CONFIG.form.fieldAttribute + ']');

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      var attrName = el.getAttribute(CONFIG.form.fieldAttribute);
      /*! v8 ignore start */
      if (!attrName) continue;
      /*! v8 ignore stop */

      var value = el.value || '';
      /*! v8 ignore start */
      if (value) {
      /*! v8 ignore stop */
        fields[attrName] = value;
      }
    }

    return fields;
  }

  function handleSubmit(e: Event): void {
    try {
      var target = e.target as Element;
      var form = target.closest('[' + CONFIG.form.formAttribute + ']') as HTMLFormElement;

      /*! v8 ignore start */
      if (!form) return;
      /*! v8 ignore stop */

      var formName = form.getAttribute(CONFIG.form.formAttribute) || '';
      /*! v8 ignore start */
      if (!formName) return;
      /*! v8 ignore stop */

      var sanitizedName = ppLib.Security.sanitize(formName);
      /*! v8 ignore start */
      if (!sanitizedName) return;
      /*! v8 ignore stop */

      // Debounce per form name
      /*! v8 ignore start */
      if (isDuplicate(sanitizedName)) return;
      /*! v8 ignore stop */

      // Prevent default if configured
      /*! v8 ignore start */
      if (CONFIG.form.preventDefault) {
      /*! v8 ignore stop */
        e.preventDefault();
      }

      // Extract fields
      var fields = extractFields(form);

      // Check requireEmail — if enabled and no valid email, reject
      /*! v8 ignore start */
      if (CONFIG.form.requireEmail) {
        if (!fields.email || !fields.email.trim()) {
        /*! v8 ignore stop */
          ppLib.log('warn', '[ppBraze] Form rejected — email required but missing');
          return;
        }
      }

      // Process user attributes
      /*! v8 ignore start */
      if (Object.keys(fields).length > 0) {
      /*! v8 ignore stop */
        userManager.processFormAttrs(fields);
      }

      // Determine event name
      var eventOverride = form.getAttribute(CONFIG.form.formEventAttribute);
      var eventName = eventOverride
        ? ppLib.Security.sanitize(eventOverride)
        : 'form_submitted_' + sanitizedName;

      // Build event properties with page context
      var properties: Record<string, string> = {
        form_name: sanitizedName,
        page_url: win.location.href,
        page_path: win.location.pathname,
        page_title: doc.title
      };

      win.braze.logCustomEvent(eventName, properties);
      ppLib.log('info', '[ppBraze] Form tracked → ' + eventName, properties);

      // Flush before navigation
      /*! v8 ignore start */
      if (CONFIG.form.flushOnSubmit) {
      /*! v8 ignore stop */
        win.braze.requestImmediateDataFlush();
      }
    } catch (err) {
      ppLib.log('error', '[ppBraze] handleSubmit error', err);
    }
  }

  function bind(): void {
    var listenerOptions: AddEventListenerOptions = CONFIG.form.preventDefault
      ? { capture: false, passive: false }
      : { capture: false, passive: true };

    doc.addEventListener('submit', handleSubmit, listenerOptions as EventListenerOptions);
    ppLib.log('info', '[ppBraze] Form handler bound');
  }

  return {
    bind: bind,
    handleSubmit: handleSubmit,
    extractFields: extractFields
  };
}
