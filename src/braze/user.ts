import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';

// Standard Braze attribute → dedicated setter method mapping
// Note: dob/setDateOfBirth is intentionally excluded — it requires 3 separate
// args (year, month, day) which can't be set from a single form field string.
// Use setCustomUserAttribute('dob', value) or the programmatic API instead.
const STANDARD_ATTRS: Record<string, string> = {
  email: 'setEmail',
  first_name: 'setFirstName',
  last_name: 'setLastName',
  phone: 'setPhoneNumber',
  gender: 'setGender',
  country: 'setCountry',
  city: 'setHomeCity',
  language: 'setLanguage'
};

export function createUserManager(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  let mapValidated = false;

  function validateAttributeMap(): void {
    if (mapValidated) return;
    mapValidated = true;
    const seen: Record<string, string> = {};
    for (const key in CONFIG.attributeMap) {
      const target = CONFIG.attributeMap[key];
      if (seen[target]) {
        ppLib.log('warn', '[ppBraze] attributeMap collision: "' + seen[target] + '" and "' + key + '" both map to "' + target + '"');
      }
      seen[target] = key;
    }
  }

  function identify(userId: string): void {
    try {
      const sanitized = ppLib.Security.sanitize(userId);
      /*! v8 ignore start */
      if (!sanitized) {
      /*! v8 ignore stop */
        ppLib.log('warn', '[ppBraze] identify called with empty userId');
        return;
      }
      win.braze.changeUser(sanitized);
      // Length intentionally omitted — even <id len=N> can fingerprint user
      // class (numeric vs UUID). The act of calling identify is the signal.
      ppLib.log('info', '[ppBraze] identify → <id>');
    } catch (e) {
      ppLib.log('error', '[ppBraze] identify error', ppLib.safeLogError(e));
    }
  }

  function setUserAttributes(attrs: Record<string, unknown>): void {
    try {
      /*! v8 ignore start */
      if (!attrs || typeof attrs !== 'object') return;
      /*! v8 ignore stop */

      validateAttributeMap();

      const user = win.braze.getUser();
      const keys = Object.keys(attrs);

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = ppLib.Security.sanitize(String(attrs[key]));

        // Check attributeMap for remapping
        /*! v8 ignore start */
        const mappedKey = CONFIG.attributeMap[key] || key;
        /*! v8 ignore stop */

        // Check if it's a standard attribute
        const setter = STANDARD_ATTRS[mappedKey];
        /*! v8 ignore start */
        if (setter && typeof user[setter] === 'function') {
        /*! v8 ignore stop */
          user[setter](value);
        } else {
          user.setCustomUserAttribute(mappedKey, value);
        }
      }

      const safeAttrs = ppLib.safeLogPayload(attrs);
      ppLib.log('info', '[ppBraze] setUserAttributes', safeAttrs);
    } catch (e) {
      ppLib.log('error', '[ppBraze] setUserAttributes error', ppLib.safeLogError(e));
    }
  }

  function setEmail(email: string): void {
    try {
      if (!email) {
        ppLib.log('warn', '[ppBraze] setEmail called with empty email');
        return;
      }
      const sanitized = ppLib.Security.sanitize(email);
      /*! v8 ignore start */
      if (!sanitized) {
        ppLib.log('warn', '[ppBraze] Email was rejected by sanitization');
        return;
      }
      /*! v8 ignore stop */
      win.braze.getUser().setEmail(sanitized);
      ppLib.log('info', '[ppBraze] setEmail → <redacted email>');
    } catch (e) {
      ppLib.log('error', '[ppBraze] setEmail error', ppLib.safeLogError(e));
    }
  }

  function autoIdentify(): void {
    if (!CONFIG.identity.autoIdentify) return;

    const userId = ppLib.getCookie(CONFIG.identity.userIdCookie);
    /*! v8 ignore start */
    if (userId && userId !== '-1') {
    /*! v8 ignore stop */
      identify(userId);
    }

    /*! v8 ignore start */
    if (CONFIG.identity.emailCookie) {
    /*! v8 ignore stop */
      const email = ppLib.getCookie(CONFIG.identity.emailCookie);
      /*! v8 ignore start */
      if (email) {
      /*! v8 ignore stop */
        setEmail(email);
      }
    }
  }

  /**
   * Process a map of form field attributes → values.
   * Separates standard attrs from custom: prefixed attrs.
   */
  function processFormAttrs(fieldMap: Record<string, string>): void {
    try {
      validateAttributeMap();

      const user = win.braze.getUser();
      const keys = Object.keys(fieldMap);

      for (let i = 0; i < keys.length; i++) {
        const attrName = keys[i];
        const value = ppLib.Security.sanitize(fieldMap[attrName]);
        /*! v8 ignore start */
        if (!value) continue;
        /*! v8 ignore stop */

        // Handle custom: prefix
        /*! v8 ignore start */
        if (attrName.indexOf('custom:') === 0) {
        /*! v8 ignore stop */
          const customKey = attrName.substring(7);
          /*! v8 ignore start */
          if (customKey) {
          /*! v8 ignore stop */
            user.setCustomUserAttribute(customKey, value);
          }
          continue;
        }

        // Check attributeMap for remapping
        /*! v8 ignore start */
        const mappedName = CONFIG.attributeMap[attrName] || attrName;
        /*! v8 ignore stop */

        // Standard attribute → dedicated setter
        const setter = STANDARD_ATTRS[mappedName];
        /*! v8 ignore start */
        if (setter && typeof user[setter] === 'function') {
        /*! v8 ignore stop */
          user[setter](value);
        } else {
          // Unmapped → custom attribute
          user.setCustomUserAttribute(mappedName, value);
        }
      }
    } catch (e) {
      ppLib.log('error', '[ppBraze] processFormAttrs error', ppLib.safeLogError(e));
    }
  }

  return {
    identify: identify,
    setUserAttributes: setUserAttributes,
    setEmail: setEmail,
    autoIdentify: autoIdentify,
    processFormAttrs: processFormAttrs,
    STANDARD_ATTRS: STANDARD_ATTRS
  };
}
