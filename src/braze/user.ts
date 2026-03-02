import type { PPLib } from '../types/common.types';
import type { BrazeConfig } from '../types/braze.types';

// Standard Braze attribute → dedicated setter method mapping
const STANDARD_ATTRS: Record<string, string> = {
  email: 'setEmail',
  first_name: 'setFirstName',
  last_name: 'setLastName',
  phone: 'setPhoneNumber',
  gender: 'setGender',
  dob: 'setDateOfBirth',
  country: 'setCountry',
  city: 'setHomeCity',
  language: 'setLanguage'
};

export function createUserManager(
  win: Window & typeof globalThis,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  function identify(userId: string): void {
    try {
      var sanitized = ppLib.Security.sanitize(userId);
      /*! v8 ignore start */
      if (!sanitized) {
      /*! v8 ignore stop */
        ppLib.log('warn', '[ppBraze] identify called with empty userId');
        return;
      }
      win.braze.changeUser(sanitized);
      ppLib.log('info', '[ppBraze] identify → ' + sanitized);
    } catch (e) {
      ppLib.log('error', '[ppBraze] identify error', e);
    }
  }

  function setUserAttributes(attrs: Record<string, any>): void {
    try {
      /*! v8 ignore start */
      if (!attrs || typeof attrs !== 'object') return;
      /*! v8 ignore stop */

      var user = win.braze.getUser();
      var keys = Object.keys(attrs);

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = ppLib.Security.sanitize(String(attrs[key]));

        // Check attributeMap for remapping
        /*! v8 ignore start */
        var mappedKey = CONFIG.attributeMap[key] || key;
        /*! v8 ignore stop */

        // Check if it's a standard attribute
        var setter = STANDARD_ATTRS[mappedKey];
        /*! v8 ignore start */
        if (setter && typeof user[setter] === 'function') {
        /*! v8 ignore stop */
          user[setter](value);
        } else {
          user.setCustomUserAttribute(mappedKey, value);
        }
      }

      ppLib.log('info', '[ppBraze] setUserAttributes', attrs);
    } catch (e) {
      ppLib.log('error', '[ppBraze] setUserAttributes error', e);
    }
  }

  function setEmail(email: string): void {
    try {
      var sanitized = ppLib.Security.sanitize(email);
      /*! v8 ignore start */
      if (!sanitized) return;
      /*! v8 ignore stop */
      win.braze.getUser().setEmail(sanitized);
      ppLib.log('info', '[ppBraze] setEmail → ' + sanitized);
    } catch (e) {
      ppLib.log('error', '[ppBraze] setEmail error', e);
    }
  }

  function autoIdentify(): void {
    if (!CONFIG.identity.autoIdentify) return;

    var userId = ppLib.getCookie(CONFIG.identity.userIdCookie);
    /*! v8 ignore start */
    if (userId && userId !== '-1') {
    /*! v8 ignore stop */
      identify(userId);
    }

    /*! v8 ignore start */
    if (CONFIG.identity.emailCookie) {
    /*! v8 ignore stop */
      var email = ppLib.getCookie(CONFIG.identity.emailCookie);
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
      var user = win.braze.getUser();
      var keys = Object.keys(fieldMap);

      for (var i = 0; i < keys.length; i++) {
        var attrName = keys[i];
        var value = ppLib.Security.sanitize(fieldMap[attrName]);
        /*! v8 ignore start */
        if (!value) continue;
        /*! v8 ignore stop */

        // Handle custom: prefix
        /*! v8 ignore start */
        if (attrName.indexOf('custom:') === 0) {
        /*! v8 ignore stop */
          var customKey = attrName.substring(7);
          /*! v8 ignore start */
          if (customKey) {
          /*! v8 ignore stop */
            user.setCustomUserAttribute(customKey, value);
          }
          continue;
        }

        // Check attributeMap for remapping
        /*! v8 ignore start */
        var mappedName = CONFIG.attributeMap[attrName] || attrName;
        /*! v8 ignore stop */

        // Standard attribute → dedicated setter
        var setter = STANDARD_ATTRS[mappedName];
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
      ppLib.log('error', '[ppBraze] processFormAttrs error', e);
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
