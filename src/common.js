/**
 * pp-analytics-lib: Common Module v1.0.0
 * Shared utilities used by all other modules.
 * Load this FIRST via <script> before any other module.
 *
 * Exposes: window.ppLib
 */
(function(window, document, undefined) {
  'use strict';

  var ppLib = window.ppLib = window.ppLib || {};
  ppLib.version = '1.0.0';

  // =====================================================
  // SAFE UTILITIES (NULL-SAFE)
  // =====================================================

  ppLib.SafeUtils = {
    get: function(obj, path, defaultValue) {
      if (!obj || typeof obj !== 'object') return defaultValue;

      var keys = path.split('.');
      var result = obj;

      for (var i = 0; i < keys.length; i++) {
        if (result === null || result === undefined || typeof result !== 'object') {
          return defaultValue;
        }
        result = result[keys[i]];
      }

      return result !== undefined ? result : defaultValue;
    },

    set: function(obj, path, value) {
      if (!obj || typeof obj !== 'object') return false;

      try {
        var keys = path.split('.');
        var target = obj;

        for (var i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
            target[keys[i]] = {};
          }
          target = target[keys[i]];
        }

        target[keys[keys.length - 1]] = value;
        return true;
      } catch (e) {
        return false;
      }
    },

    toString: function(val) {
      if (val === null || val === undefined) return '';
      return String(val);
    },

    exists: function(val) {
      return val !== null && val !== undefined && val !== '';
    },

    toArray: function(val) {
      if (Array.isArray(val)) return val;
      if (!val) return [];
      return [val];
    },

    forEach: function(arr, callback) {
      if (!Array.isArray(arr) || typeof callback !== 'function') return;

      try {
        for (var i = 0; i < arr.length; i++) {
          callback(arr[i], i, arr);
        }
      } catch (e) {
        ppLib.log('error', 'forEach error:', e);
      }
    }
  };

  // =====================================================
  // CONFIGURATION (BASE)
  // =====================================================

  ppLib.config = {
    debug: false,
    verbose: false,
    namespace: 'pp_attr',

    security: {
      maxParamLength: 500,
      maxStorageSize: 4096,
      maxUrlLength: 2048,
      enableSanitization: true,
      strictMode: false
    }
  };

  // =====================================================
  // LOGGING
  // =====================================================

  ppLib.log = function(level, message, data) {
    if (!ppLib.config.debug) return;
    if (level === 'verbose' && !ppLib.config.verbose) return;

    try {
      var prefix = '[ppLib v' + ppLib.version + ']';
      var logFn = console[level] || console.log;
      logFn.call(console, prefix, message, data || '');
    } catch (e) {
      // Silent fail for logging
    }
  };

  // =====================================================
  // COOKIE UTILITIES
  // =====================================================

  ppLib.getCookie = function(name) {
    try {
      if (!name || !document.cookie) return null;

      var match = document.cookie.match(new RegExp('(^| )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]+)'));
      if (match) return decodeURIComponent(match[2]);
      return null;
    } catch (e) {
      return null;
    }
  };

  ppLib.deleteCookie = function(name) {
    try {
      if (!name) return;
      document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      document.cookie = name + '=; Path=' + window.location.pathname + '; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    } catch (e) {
      ppLib.log('error', 'deleteCookie error', e);
    }
  };

  // =====================================================
  // URL UTILITIES
  // =====================================================

  ppLib.getQueryParam = function(url, findParam) {
    try {
      if (!findParam || !url) return '';

      var urlSplit = url.split('?');
      var queryParams = urlSplit.length > 1 ? '?' + urlSplit[1] : urlSplit[0];
      var urlSearchParams = new URLSearchParams(queryParams);
      var params = {};
      urlSearchParams.forEach(function(value, key) {
        params[key] = value;
      });

      var param = Object.keys(params).find(function(key) {
        return key.toLowerCase() === findParam.toLowerCase();
      });

      if (!param) return '';
      return decodeURIComponent(params[param]);
    } catch (e) {
      return '';
    }
  };

  // =====================================================
  // SECURITY MODULE (NULL-SAFE)
  // =====================================================

  ppLib.Security = {
    sanitize: function(input) {
      try {
        if (!ppLib.config.security.enableSanitization) return ppLib.SafeUtils.toString(input);
        if (!ppLib.SafeUtils.exists(input)) return '';

        var str = ppLib.SafeUtils.toString(input);

        var sanitized = str
          .replace(/[<>'"]/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .replace(/[\x00-\x1F\x7F]/g, '')
          .replace(/data:text\/html/gi, '')
          .substring(0, ppLib.config.security.maxParamLength);

        if (ppLib.config.security.strictMode && sanitized !== str.substring(0, ppLib.config.security.maxParamLength)) {
          ppLib.log('warn', 'Rejected suspicious input');
          return '';
        }

        return sanitized;
      } catch (e) {
        ppLib.log('error', 'Sanitize error', e);
        return '';
      }
    },

    isValidUrl: function(url) {
      try {
        if (!url || typeof url !== 'string') return false;
        if (url.length > ppLib.config.security.maxUrlLength) return false;

        var parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (e) {
        return false;
      }
    },

    json: {
      parse: function(str, fallback) {
        try {
          if (!ppLib.SafeUtils.exists(str)) return fallback || null;

          var parsed = JSON.parse(str);
          var stringified = JSON.stringify(parsed);

          if (stringified.length > ppLib.config.security.maxStorageSize) {
            ppLib.log('error', 'Data exceeds size limit');
            return fallback || null;
          }

          return parsed;
        } catch (e) {
          ppLib.log('verbose', 'JSON parse error', e);
          return fallback || null;
        }
      },

      stringify: function(obj) {
        try {
          if (!obj) return null;

          var str = JSON.stringify(obj);

          if (str.length > ppLib.config.security.maxStorageSize) {
            ppLib.log('error', 'Data too large to stringify');
            return null;
          }

          return str;
        } catch (e) {
          ppLib.log('error', 'JSON stringify error', e);
          return null;
        }
      }
    },

    validateData: function(data) {
      try {
        if (!data || typeof data !== 'object') return false;

        var jsonStr = JSON.stringify(data);
        var dangerousPatterns = [
          /<script/i,
          /javascript:/i,
          /on\w+=/i,
          /eval\(/i,
          /expression\(/i,
          /data:text\/html/i
        ];

        for (var i = 0; i < dangerousPatterns.length; i++) {
          if (dangerousPatterns[i].test(jsonStr)) {
            ppLib.log('error', 'Dangerous pattern detected');
            return false;
          }
        }

        return true;
      } catch (e) {
        return false;
      }
    }
  };

  // =====================================================
  // STORAGE MODULE (NULL-SAFE)
  // =====================================================

  ppLib.Storage = {
    isAvailable: function(type) {
      try {
        type = type || 'sessionStorage';
        var storage = window[type];
        if (!storage) return false;

        var test = '__storage_test__';
        storage.setItem(test, test);
        storage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    },

    getKey: function(key) {
      try {
        var namespace = ppLib.config.namespace || 'pp_attr';
        return namespace + '_' + key;
      } catch (e) {
        return 'pp_attr_' + key;
      }
    },

    set: function(key, value, persistent) {
      try {
        if (!ppLib.SafeUtils.exists(key) || !value) return false;

        var storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!this.isAvailable(storageType)) return false;

        if (!ppLib.Security.validateData(value)) {
          ppLib.log('error', 'Invalid data rejected');
          return false;
        }

        var stringified = ppLib.Security.json.stringify(value);
        if (!stringified) return false;

        window[storageType].setItem(this.getKey(key), stringified);
        return true;
      } catch (e) {
        ppLib.log('verbose', 'Storage set error', e);
        return false;
      }
    },

    get: function(key, persistent) {
      try {
        if (!ppLib.SafeUtils.exists(key)) return null;

        var storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!this.isAvailable(storageType)) return null;

        var item = window[storageType].getItem(this.getKey(key));
        if (!ppLib.SafeUtils.exists(item)) return null;

        var parsed = ppLib.Security.json.parse(item);

        if (parsed && typeof parsed === 'object' && !ppLib.Security.validateData(parsed)) {
          this.remove(key, persistent);
          return null;
        }

        return parsed;
      } catch (e) {
        ppLib.log('verbose', 'Storage get error', e);
        return null;
      }
    },

    remove: function(key, persistent) {
      try {
        if (!ppLib.SafeUtils.exists(key)) return;

        var storageType = persistent ? 'localStorage' : 'sessionStorage';

        if (!this.isAvailable(storageType)) return;

        window[storageType].removeItem(this.getKey(key));
      } catch (e) {
        ppLib.log('verbose', 'Storage remove error', e);
      }
    },

    clear: function() {
      try {
        this.remove('first_touch');
        this.remove('last_touch');
        this.remove('session_start');
        this.remove('first_touch', true);
        this.remove('last_touch', true);
        ppLib.log('info', 'Storage cleared');
      } catch (e) {
        ppLib.log('error', 'Storage clear error', e);
      }
    }
  };

  // =====================================================
  // UTILITY HELPERS
  // =====================================================

  ppLib.extend = function(target, source) {
    if (!target || !source) return target || {};

    try {
      for (var key in source) {
        if (source.hasOwnProperty(key)) {
          if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
            target[key] = target[key] || {};
            ppLib.extend(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
      }
    } catch (e) {
      ppLib.log('error', 'Extend error:', e);
    }

    return target;
  };

  ppLib.log('info', 'Common module loaded');

})(window, document);
