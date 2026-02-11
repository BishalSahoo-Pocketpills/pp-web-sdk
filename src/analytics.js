/**
 * pp-analytics-lib: Analytics & Attribution Tracker v1.0.0
 * Based on PocketPills Analytics & Attribution Tracker v3.1
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppAnalytics
 */
(function(window, document, undefined) {
  'use strict';

  var ppLib = window.ppLib;
  if (!ppLib) {
    console.error('[ppAnalytics] common.js must be loaded first');
    return;
  }

  var SafeUtils = ppLib.SafeUtils;
  var Security = ppLib.Security;
  var Storage = ppLib.Storage;

  // =====================================================
  // CONFIGURATION
  // =====================================================

  var CONFIG = {
    version: '3.1.0',
    namespace: ppLib.config.namespace || 'pp_attr',

    consent: {
      required: false,
      defaultState: 'approved',
      storageKey: 'pp_consent',
      frameworks: {
        oneTrust: { enabled: false, cookieName: 'OptanonConsent', categoryId: 'C0002' },
        cookieYes: { enabled: false, cookieName: 'cookieyes-consent', categoryId: 'analytics' },
        custom: { enabled: false, checkFunction: function() { return true; } }
      }
    },

    parameters: {
      utm: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
      ads: {
        google: ['gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid'],
        facebook: ['fbclid', 'fb_action_ids'],
        microsoft: ['msclkid'],
        tiktok: ['ttclid'],
        linkedin: ['li_fat_id'],
        twitter: ['twclid'],
        pinterest: ['epik'],
        snapchat: ['ScCid']
      },
      custom: ['ref', 'referrer', 'promo', 'affiliate_id']
    },

    attribution: {
      sessionTimeout: 30,
      enableFirstTouch: true,
      enableLastTouch: true,
      persistAcrossSessions: false,
      trackPageViews: true,
      autoCapture: true
    },

    platforms: {
      gtm: {
        enabled: true,
        events: {
          firstTouch: 'first_touch_attribution',
          lastTouch: 'last_touch_attribution',
          pageView: 'attribution_page_view'
        },
        rateLimitMax: 100,
        rateLimitWindow: 60000
      },
      ga4: { enabled: true, measurementId: null, sendPageView: true },
      mixpanel: { enabled: true, trackPageView: true, maxRetries: 50, retryInterval: 100 },
      custom: []
    },

    performance: {
      useRequestIdleCallback: true,
      queueEnabled: true,
      maxQueueSize: 50
    },

    debug: ppLib.config.debug || false,
    verbose: ppLib.config.verbose || false
  };

  // =====================================================
  // UTILITIES
  // =====================================================

  var Utils = {
    getAllParamNames: function() {
      try {
        var params = (CONFIG.parameters.utm || []).slice();

        var ads = CONFIG.parameters.ads || {};
        for (var platform in ads) {
          if (ads.hasOwnProperty(platform) && Array.isArray(ads[platform])) {
            params = params.concat(ads[platform]);
          }
        }

        params = params.concat(CONFIG.parameters.custom || []);
        return params;
      } catch (e) {
        ppLib.log('error', 'getAllParamNames error', e);
        return [];
      }
    },

    log: function(level, message, data) {
      if (!CONFIG.debug) return;
      if (level === 'verbose' && !CONFIG.verbose) return;

      try {
        var prefix = '[ppAnalytics v' + CONFIG.version + ']';
        var logFn = console[level] || console.log;
        logFn.call(console, prefix, message, data || '');
      } catch (e) {
        // Silent fail for logging
      }
    },

    isValidParam: function(name) {
      try {
        if (!SafeUtils.exists(name)) return false;
        var whitelist = this.getAllParamNames();
        return whitelist.indexOf(name) !== -1;
      } catch (e) {
        return false;
      }
    }
  };

  // =====================================================
  // CONSENT MODULE (NULL-SAFE)
  // =====================================================

  var Consent = {
    state: SafeUtils.get(CONFIG, 'consent.defaultState', 'approved'),

    isGranted: function() {
      try {
        if (!SafeUtils.get(CONFIG, 'consent.required', false)) {
          return true;
        }

        if (SafeUtils.get(CONFIG, 'consent.frameworks.custom.enabled', false)) {
          try {
            var checkFn = SafeUtils.get(CONFIG, 'consent.frameworks.custom.checkFunction');
            if (typeof checkFn === 'function') {
              return checkFn();
            }
          } catch (e) {
            Utils.log('error', 'Custom consent check failed', e);
          }
        }

        if (SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.enabled', false)) {
          if (this.checkOneTrust()) return true;
        }

        if (SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.enabled', false)) {
          if (this.checkCookieYes()) return true;
        }

        return this.getStoredConsent();
      } catch (e) {
        Utils.log('error', 'Consent check error', e);
        return this.state === 'approved';
      }
    },

    checkOneTrust: function() {
      try {
        var groups = window.OnetrustActiveGroups;
        if (SafeUtils.exists(groups)) {
          var categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.categoryId', 'C0002');
          return groups.indexOf(categoryId) !== -1;
        }
      } catch (e) {
        Utils.log('verbose', 'OneTrust check failed', e);
      }
      return false;
    },

    checkCookieYes: function() {
      try {
        var cookieName = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.cookieName', 'cookieyes-consent');
        var cookie = ppLib.getCookie(cookieName);

        if (SafeUtils.exists(cookie)) {
          var consent = Security.json.parse(cookie);
          var categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.categoryId', 'analytics');
          return SafeUtils.get(consent, categoryId) === 'yes';
        }
      } catch (e) {
        Utils.log('verbose', 'CookieYes check failed', e);
      }
      return false;
    },

    getStoredConsent: function() {
      try {
        var storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        var stored = localStorage.getItem(storageKey);

        if (SafeUtils.exists(stored)) {
          this.state = stored;
          return stored === 'approved';
        }
      } catch (e) {
        Utils.log('verbose', 'Could not read consent from storage');
      }

      return this.state === 'approved';
    },

    setConsent: function(granted) {
      try {
        this.state = granted ? 'approved' : 'denied';

        var storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        localStorage.setItem(storageKey, this.state);

        Utils.log('info', 'Consent updated', { state: this.state });

        if (granted) {
          Tracker.init();
        } else {
          Storage.clear();
        }
      } catch (e) {
        Utils.log('error', 'Set consent error', e);
      }
    }
  };

  // =====================================================
  // URL PARSER MODULE (NULL-SAFE, AUTO-CAPTURE)
  // =====================================================

  var UrlParser = {
    getParams: function() {
      try {
        var currentUrl = window.location && window.location.href;
        if (!currentUrl || !Security.isValidUrl(currentUrl)) {
          Utils.log('verbose', 'Invalid or missing URL');
          return {};
        }

        var params = {};
        var searchParams = new URLSearchParams(window.location.search || '');
        var whitelist = Utils.getAllParamNames();

        SafeUtils.forEach(whitelist, function(param) {
          try {
            var value = searchParams.get(param);
            if (SafeUtils.exists(value)) {
              var sanitized = Security.sanitize(value);
              if (SafeUtils.exists(sanitized)) {
                params[param] = sanitized;
              }
            }
          } catch (e) {
            Utils.log('verbose', 'Param extraction error for ' + param, e);
          }
        });

        return params;
      } catch (e) {
        Utils.log('error', 'URL parse error', e);
        return {};
      }
    },

    getTrackedParams: function() {
      try {
        var params = this.getParams();

        if (!params || Object.keys(params).length === 0) {
          return null;
        }

        try {
          params.landing_page = Security.sanitize(
            (window.location.origin || '') + (window.location.pathname || '')
          );
          params.referrer = this.getReferrer();
          params.timestamp = new Date().toISOString();
        } catch (e) {
          Utils.log('verbose', 'Metadata error', e);
        }

        return params;
      } catch (e) {
        Utils.log('error', 'getTrackedParams error', e);
        return null;
      }
    },

    getReferrer: function() {
      try {
        var referrer = document.referrer;
        if (!SafeUtils.exists(referrer)) return 'direct';

        var referrerUrl = new URL(referrer);
        var currentUrl = new URL(window.location.href);

        if (referrerUrl.hostname === currentUrl.hostname) {
          return 'internal';
        }

        return Security.sanitize(referrerUrl.origin) || 'unknown';
      } catch (e) {
        return document.referrer ? 'unknown' : 'direct';
      }
    }
  };

  // =====================================================
  // SESSION MODULE (NULL-SAFE)
  // =====================================================

  var Session = {
    isValid: function() {
      try {
        var sessionStart = Storage.get('session_start');
        if (!sessionStart || typeof sessionStart !== 'number') {
          return false;
        }

        var now = new Date().getTime();
        var sessionAge = (now - sessionStart) / 1000 / 60;
        var timeout = SafeUtils.get(CONFIG, 'attribution.sessionTimeout', 30);

        return sessionAge < timeout;
      } catch (e) {
        return false;
      }
    },

    start: function() {
      try {
        Storage.set('session_start', new Date().getTime());
      } catch (e) {
        Utils.log('error', 'Session start error', e);
      }
    }
  };

  // =====================================================
  // EVENT QUEUE MODULE (NULL-SAFE)
  // =====================================================

  var EventQueue = {
    queue: [],
    processing: false,
    rateLimits: {},

    add: function(event) {
      try {
        if (!event || typeof event !== 'object') return;

        if (!SafeUtils.get(CONFIG, 'performance.queueEnabled', true)) {
          this.process(event);
          return;
        }

        var maxSize = SafeUtils.get(CONFIG, 'performance.maxQueueSize', 50);
        if (this.queue.length >= maxSize) {
          Utils.log('warn', 'Event queue full, dropping event');
          return;
        }

        this.queue.push(event);
        this.scheduleProcessing();
      } catch (e) {
        Utils.log('error', 'Queue add error', e);
      }
    },

    scheduleProcessing: function() {
      try {
        if (this.processing) return;

        var self = this;
        var useIdleCallback = SafeUtils.get(CONFIG, 'performance.useRequestIdleCallback', true);

        if (useIdleCallback && window.requestIdleCallback) {
          requestIdleCallback(function() {
            self.processQueue();
          }, { timeout: 2000 });
        } else {
          setTimeout(function() {
            self.processQueue();
          }, 0);
        }
      } catch (e) {
        Utils.log('error', 'Schedule processing error', e);
      }
    },

    processQueue: function() {
      try {
        this.processing = true;

        while (this.queue.length > 0) {
          var event = this.queue.shift();
          if (event) {
            this.process(event);
          }
        }

        this.processing = false;
      } catch (e) {
        Utils.log('error', 'Process queue error', e);
        this.processing = false;
      }
    },

    checkRateLimit: function(key, max, windowMs) {
      try {
        if (!SafeUtils.exists(key)) return false;

        var now = Date.now();

        if (!this.rateLimits[key]) {
          this.rateLimits[key] = { count: 0, resetAt: now + windowMs };
        }

        var limit = this.rateLimits[key];

        if (now > limit.resetAt) {
          limit.count = 0;
          limit.resetAt = now + windowMs;
        }

        if (limit.count >= max) {
          Utils.log('warn', 'Rate limit exceeded for ' + key);
          return false;
        }

        limit.count++;
        return true;
      } catch (e) {
        return true;
      }
    },

    process: function(event) {
      try {
        if (!event || !event.type) return;

        var eventType = SafeUtils.toString(event.type);

        if (eventType === 'gtm' && SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          var max = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitMax', 100);
          var windowMs = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitWindow', 60000);

          if (this.checkRateLimit('gtm', max, windowMs)) {
            Platforms.GTM.push(event.data);
          }
        } else if (eventType === 'mixpanel' && SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
          Platforms.Mixpanel.send(event.data);
        } else if (eventType === 'custom') {
          if (event.handler && typeof event.handler === 'function') {
            event.handler(event.data);
          }
        }
      } catch (e) {
        Utils.log('error', 'Event processing error', e);
      }
    }
  };

  // =====================================================
  // PLATFORMS MODULE (NULL-SAFE)
  // =====================================================

  var Platforms = {
    GTM: {
      push: function(data) {
        try {
          if (!data || typeof data !== 'object') return;

          window.dataLayer = window.dataLayer || [];

          if (!Security.validateData(data)) {
            Utils.log('error', 'Invalid GTM data rejected');
            return;
          }

          window.dataLayer.push(data);
          Utils.log('verbose', 'Pushed to GTM', data);
        } catch (e) {
          Utils.log('error', 'GTM push error', e);
        }
      }
    },

    Mixpanel: {
      ready: false,
      queue: [],

      send: function(data) {
        try {
          if (!data || typeof data !== 'object') return;

          if (!Security.validateData(data)) {
            Utils.log('error', 'Invalid Mixpanel data rejected');
            return;
          }

          if (!this.ready) {
            this.queue.push(data);
            this.checkReady();
            return;
          }

          var dataType = SafeUtils.get(data, 'type', '');

          if (dataType === 'register' && window.mixpanel && window.mixpanel.register) {
            window.mixpanel.register(data.properties || {});
          } else if (dataType === 'track' && window.mixpanel && window.mixpanel.track) {
            window.mixpanel.track(data.eventName || 'Unknown Event', data.properties || {});
          }

          Utils.log('verbose', 'Sent to Mixpanel', data);
        } catch (e) {
          Utils.log('error', 'Mixpanel send error', e);
        }
      },

      checkReady: function() {
        try {
          var self = this;
          var attempts = 0;
          var maxRetries = SafeUtils.get(CONFIG, 'platforms.mixpanel.maxRetries', 50);
          var retryInterval = SafeUtils.get(CONFIG, 'platforms.mixpanel.retryInterval', 100);

          var check = setInterval(function() {
            attempts++;

            if (attempts >= maxRetries) {
              clearInterval(check);
              Utils.log('verbose', 'Mixpanel not available');
              return;
            }

            if (window.mixpanel && window.mixpanel.register) {
              clearInterval(check);
              self.ready = true;

              while (self.queue.length > 0) {
                var data = self.queue.shift();
                if (data) {
                  self.send(data);
                }
              }
            }
          }, retryInterval);
        } catch (e) {
          Utils.log('error', 'Mixpanel check ready error', e);
        }
      }
    },

    register: function(name, handler) {
      try {
        if (!SafeUtils.exists(name) || typeof handler !== 'function') return;

        CONFIG.platforms.custom = CONFIG.platforms.custom || [];
        CONFIG.platforms.custom.push({ name: name, handler: handler });

        Utils.log('info', 'Registered custom platform: ' + name);
      } catch (e) {
        Utils.log('error', 'Register platform error', e);
      }
    }
  };

  // =====================================================
  // MAIN TRACKER MODULE (NULL-SAFE, AUTO-CAPTURE)
  // =====================================================

  var Tracker = {
    initialized: false,

    init: function() {
      try {
        if (!Consent.isGranted()) {
          Utils.log('info', 'Consent not granted, skipping tracking');
          return;
        }

        Utils.log('info', 'Initializing tracker v' + CONFIG.version);

        var currentParams = null;

        if (SafeUtils.get(CONFIG, 'attribution.autoCapture', true)) {
          currentParams = UrlParser.getTrackedParams();
        }

        if (currentParams && Object.keys(currentParams).length > 0) {
          Utils.log('verbose', 'Auto-captured tracking parameters', currentParams);

          if (SafeUtils.get(CONFIG, 'attribution.enableLastTouch', true)) {
            Storage.set('last_touch', currentParams);
          }

          if (SafeUtils.get(CONFIG, 'attribution.enableFirstTouch', true)) {
            var persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
            var existingFirstTouch = Storage.get('first_touch', persist);
            var sessionValid = Session.isValid();

            if (!existingFirstTouch || !sessionValid) {
              Storage.set('first_touch', currentParams, persist);
              Session.start();
              Utils.log('verbose', 'Stored first-touch attribution');
            }
          }
        }

        this.sendAttribution();

        if (SafeUtils.get(CONFIG, 'attribution.trackPageViews', true)) {
          this.trackPageView();
        }

        this.initialized = true;
        Utils.log('info', 'Tracker initialized successfully');

      } catch (e) {
        Utils.log('error', 'Tracker initialization error', e);
      }
    },

    sendAttribution: function() {
      try {
        var persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
        var firstTouch = Storage.get('first_touch', persist) || {};
        var lastTouch = Storage.get('last_touch') || {};

        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          if (Object.keys(firstTouch).length > 0) {
            EventQueue.add({
              type: 'gtm',
              data: {
                event: SafeUtils.get(CONFIG, 'platforms.gtm.events.firstTouch', 'first_touch_attribution'),
                first_touch_source: SafeUtils.get(firstTouch, 'utm_source', 'direct'),
                first_touch_medium: SafeUtils.get(firstTouch, 'utm_medium', 'none'),
                first_touch_campaign: SafeUtils.get(firstTouch, 'utm_campaign', ''),
                first_touch_term: SafeUtils.get(firstTouch, 'utm_term', ''),
                first_touch_content: SafeUtils.get(firstTouch, 'utm_content', ''),
                first_touch_gclid: SafeUtils.get(firstTouch, 'gclid', ''),
                first_touch_fbclid: SafeUtils.get(firstTouch, 'fbclid', ''),
                first_touch_landing_page: SafeUtils.get(firstTouch, 'landing_page', ''),
                first_touch_referrer: SafeUtils.get(firstTouch, 'referrer', ''),
                first_touch_timestamp: SafeUtils.get(firstTouch, 'timestamp', '')
              }
            });
          }

          if (Object.keys(lastTouch).length > 0) {
            EventQueue.add({
              type: 'gtm',
              data: {
                event: SafeUtils.get(CONFIG, 'platforms.gtm.events.lastTouch', 'last_touch_attribution'),
                last_touch_source: SafeUtils.get(lastTouch, 'utm_source', 'direct'),
                last_touch_medium: SafeUtils.get(lastTouch, 'utm_medium', 'none'),
                last_touch_campaign: SafeUtils.get(lastTouch, 'utm_campaign', ''),
                last_touch_term: SafeUtils.get(lastTouch, 'utm_term', ''),
                last_touch_content: SafeUtils.get(lastTouch, 'utm_content', ''),
                last_touch_gclid: SafeUtils.get(lastTouch, 'gclid', ''),
                last_touch_fbclid: SafeUtils.get(lastTouch, 'fbclid', ''),
                last_touch_landing_page: SafeUtils.get(lastTouch, 'landing_page', ''),
                last_touch_referrer: SafeUtils.get(lastTouch, 'referrer', ''),
                last_touch_timestamp: SafeUtils.get(lastTouch, 'timestamp', '')
              }
            });
          }
        }

        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
          var mixpanelProps = {};

          if (Object.keys(firstTouch).length > 0) {
            mixpanelProps['First Touch Source'] = SafeUtils.get(firstTouch, 'utm_source', 'direct');
            mixpanelProps['First Touch Medium'] = SafeUtils.get(firstTouch, 'utm_medium', 'none');
            mixpanelProps['First Touch Campaign'] = SafeUtils.get(firstTouch, 'utm_campaign', '');
            mixpanelProps['First Touch Landing Page'] = SafeUtils.get(firstTouch, 'landing_page', '');
          }

          if (Object.keys(lastTouch).length > 0) {
            mixpanelProps['Last Touch Source'] = SafeUtils.get(lastTouch, 'utm_source', 'direct');
            mixpanelProps['Last Touch Medium'] = SafeUtils.get(lastTouch, 'utm_medium', 'none');
            mixpanelProps['Last Touch Campaign'] = SafeUtils.get(lastTouch, 'utm_campaign', '');
            mixpanelProps['Last Touch Landing Page'] = SafeUtils.get(lastTouch, 'landing_page', '');
          }

          if (Object.keys(mixpanelProps).length > 0) {
            EventQueue.add({
              type: 'mixpanel',
              data: {
                type: 'register',
                properties: mixpanelProps
              }
            });
          }
        }

        var customPlatforms = SafeUtils.get(CONFIG, 'platforms.custom', []);
        SafeUtils.forEach(customPlatforms, function(platform) {
          if (platform && platform.handler) {
            EventQueue.add({
              type: 'custom',
              handler: platform.handler,
              data: {
                firstTouch: firstTouch,
                lastTouch: lastTouch
              }
            });
          }
        });

      } catch (e) {
        Utils.log('error', 'Send attribution error', e);
      }
    },

    trackPageView: function() {
      try {
        var data = {
          page_url: SafeUtils.get(window, 'location.href', ''),
          page_title: SafeUtils.get(document, 'title', ''),
          page_path: SafeUtils.get(window, 'location.pathname', '')
        };

        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          EventQueue.add({
            type: 'gtm',
            data: ppLib.extend({
              event: SafeUtils.get(CONFIG, 'platforms.gtm.events.pageView', 'attribution_page_view')
            }, data)
          });
        }

        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true) &&
            SafeUtils.get(CONFIG, 'platforms.mixpanel.trackPageView', true)) {
          EventQueue.add({
            type: 'mixpanel',
            data: {
              type: 'track',
              eventName: 'Page View',
              properties: data
            }
          });
        }
      } catch (e) {
        Utils.log('error', 'Track page view error', e);
      }
    },

    track: function(eventName, properties) {
      try {
        if (!this.initialized) {
          Utils.log('warn', 'Tracker not initialized, queuing event');
        }

        if (!SafeUtils.exists(eventName)) {
          Utils.log('error', 'Event name required');
          return;
        }

        properties = properties || {};

        var persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
        var firstTouch = Storage.get('first_touch', persist);
        var lastTouch = Storage.get('last_touch');

        if (firstTouch) {
          properties.first_touch_source = SafeUtils.get(firstTouch, 'utm_source', 'direct');
          properties.first_touch_campaign = SafeUtils.get(firstTouch, 'utm_campaign', '');
        }

        if (lastTouch) {
          properties.last_touch_source = SafeUtils.get(lastTouch, 'utm_source', 'direct');
          properties.last_touch_campaign = SafeUtils.get(lastTouch, 'utm_campaign', '');
        }

        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          EventQueue.add({
            type: 'gtm',
            data: ppLib.extend({ event: eventName }, properties)
          });
        }

        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
          EventQueue.add({
            type: 'mixpanel',
            data: {
              type: 'track',
              eventName: eventName,
              properties: properties
            }
          });
        }

        Utils.log('verbose', 'Tracked event: ' + eventName, properties);
      } catch (e) {
        Utils.log('error', 'Track error', e);
      }
    },

    getAttribution: function() {
      try {
        var persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
        return {
          firstTouch: Storage.get('first_touch', persist) || null,
          lastTouch: Storage.get('last_touch') || null
        };
      } catch (e) {
        Utils.log('error', 'Get attribution error', e);
        return { firstTouch: null, lastTouch: null };
      }
    }
  };

  // =====================================================
  // PUBLIC API
  // =====================================================

  var API = {
    version: CONFIG.version,

    config: function(options) {
      try {
        if (options) {
          ppLib.extend(CONFIG, options);
          Utils.log('info', 'Configuration updated');
        }
        return CONFIG;
      } catch (e) {
        Utils.log('error', 'Config error', e);
        return CONFIG;
      }
    },

    consent: {
      grant: function() {
        Consent.setConsent(true);
      },
      revoke: function() {
        Consent.setConsent(false);
      },
      status: function() {
        return Consent.isGranted();
      }
    },

    track: function(eventName, properties) {
      Tracker.track(eventName, properties);
    },

    getAttribution: function() {
      return Tracker.getAttribution();
    },

    registerPlatform: function(name, handler) {
      Platforms.register(name, handler);
    },

    clear: function() {
      Storage.clear();
    },

    init: function() {
      Tracker.init();
    }
  };

  // =====================================================
  // AUTO-INITIALIZATION
  // =====================================================

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        Tracker.init();
      });
    } else {
      Tracker.init();
    }
  } catch (e) {
    Utils.log('error', 'Fatal initialization error', e);
  }

  // =====================================================
  // EXPOSE API
  // =====================================================

  window.ppAnalytics = API;

  if (CONFIG.debug) {
    console.log('[ppAnalytics] API ready at window.ppAnalytics');

    window.ppAnalyticsDebug = {
      config: CONFIG,
      consent: Consent,
      tracker: Tracker,
      platforms: Platforms,
      queue: EventQueue
    };
  }

})(window, document);
