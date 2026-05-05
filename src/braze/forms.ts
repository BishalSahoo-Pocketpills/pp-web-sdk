import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';

export function createFormHandler(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig,
  userManager: {
    processFormAttrs: (fieldMap: Record<string, string>) => void;
    identify: (userId: string) => void;
  }
) {
  const lastSubmitMap: Record<string, number> = {};
  let debounceWriteCount = 0;
  let bound = false;

  function isDuplicate(formName: string): boolean {
    const now = Date.now();
    /*! v8 ignore start */
    // Prune stale entries every 100 writes to prevent unbounded growth
    if (++debounceWriteCount >= 100) {
      debounceWriteCount = 0;
      for (const k in lastSubmitMap) {
        if ((now - lastSubmitMap[k]) >= CONFIG.form.debounceMs) {
          delete lastSubmitMap[k];
        }
      }
    }
    if (lastSubmitMap[formName] && (now - lastSubmitMap[formName]) < CONFIG.form.debounceMs) {
    /*! v8 ignore stop */
      return true;
    }
    lastSubmitMap[formName] = now;
    return false;
  }

  function extractFields(form: HTMLFormElement): Record<string, string> {
    const fields: Record<string, string> = {};
    const elements = form.querySelectorAll('[' + CONFIG.form.fieldAttribute + ']');

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const attrName = el.getAttribute(CONFIG.form.fieldAttribute);
      /*! v8 ignore start */
      if (!attrName) continue;
      /*! v8 ignore stop */

      const value = el.value || '';
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
      const target = e.target as Element;
      const form = target.closest('[' + CONFIG.form.formAttribute + ']') as HTMLFormElement;

      /*! v8 ignore start */
      if (!form) return;
      /*! v8 ignore stop */

      const formName = form.getAttribute(CONFIG.form.formAttribute) || '';
      /*! v8 ignore start */
      if (!formName) {
        ppLib.log('warn', '[ppBraze] Form element found but [' + CONFIG.form.formAttribute + '] attribute is empty');
        return;
      }
      /*! v8 ignore stop */

      const sanitizedName = ppLib.Security.sanitize(formName);
      /*! v8 ignore start */
      if (!sanitizedName) {
        ppLib.log('warn', '[ppBraze] Form name was rejected by sanitization: ' + formName);
        return;
      }
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
      const fields = extractFields(form);

      // Check requireEmail — if enabled and no valid email, reject
      /*! v8 ignore start */
      if (CONFIG.form.requireEmail) {
        if (!fields.email || !fields.email.trim()) {
        /*! v8 ignore stop */
          ppLib.log('warn', '[ppBraze] Form rejected — email required but missing');
          return;
        }
      }

      // Identify by email if configured and user is not already identified
      /*! v8 ignore start */
      if (CONFIG.form.identifyByEmail && fields.email) {
      /*! v8 ignore stop */
        const emailVal = fields.email.trim();
        /*! v8 ignore start */
        if (emailVal) {
        /*! v8 ignore stop */
          const existingUserId = ppLib.getCookie(CONFIG.identity.userIdCookie);
          /*! v8 ignore start */
          if (!existingUserId || existingUserId === '-1') {
          /*! v8 ignore stop */
            userManager.identify(emailVal);
          }
        }
      }

      // Process user attributes
      /*! v8 ignore start */
      if (Object.keys(fields).length > 0) {
      /*! v8 ignore stop */
        userManager.processFormAttrs(fields);
      }

      // Determine event name
      const eventOverride = form.getAttribute(CONFIG.form.formEventAttribute);
      const eventName = eventOverride
        ? ppLib.Security.sanitize(eventOverride)
        : 'form_submitted_' + sanitizedName;

      // Build event properties with page context
      const properties: Record<string, string> = {
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
    if (bound) return;
    bound = true;

    const listenerOptions: AddEventListenerOptions = CONFIG.form.preventDefault
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
