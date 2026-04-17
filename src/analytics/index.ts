/**
 * pp-analytics-lib: Analytics & Attribution Tracker
 * Based on PocketPills Analytics & Attribution Tracker v3.1
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppAnalytics
 */
import type { PPLib } from '@src/types/common.types';
import type { AnalyticsConfig, QueueEvent, RateLimitEntry, TrackedParams, CustomPlatform } from '@src/types/analytics.types';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  const SafeUtils = ppLib.SafeUtils;
  const Security = ppLib.Security;
  const Storage = ppLib.Storage;

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const CONFIG: AnalyticsConfig = {
    version: '3.1.0',
    /*! v8 ignore start */
    namespace: ppLib.config.namespace || 'pp_attr',
    /*! v8 ignore stop */

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

    /*! v8 ignore start */
    debug: ppLib.config.debug || false,
    verbose: ppLib.config.verbose || false
    /*! v8 ignore stop */
  };

  // =====================================================
  // UTILITIES
  // =====================================================

  let cachedParamNames: string[] | null = null;

  const Utils = {
    getAllParamNames: function(): string[] {
      try {
        /*! v8 ignore start */
        if (cachedParamNames) return cachedParamNames;
        /*! v8 ignore stop */

        /*! v8 ignore start */
        let params = (CONFIG.parameters.utm || []).slice();
        /*! v8 ignore stop */

        /*! v8 ignore start */
        const ads: Record<string, string[]> = (CONFIG.parameters.ads || {}) as unknown as Record<string, string[]>;
        /*! v8 ignore stop */
        for (const platform in ads) {
          /*! v8 ignore start */
          if (ads.hasOwnProperty(platform) && Array.isArray(ads[platform])) {
          /*! v8 ignore stop */
            params = params.concat(ads[platform]);
          }
        }

        /*! v8 ignore start */
        params = params.concat(CONFIG.parameters.custom || []);
        /*! v8 ignore stop */
        cachedParamNames = params;
        return params;
      } catch (e) {
        ppLib.log('error', 'getAllParamNames error', e);
        return [];
      }
    },

    /*! v8 ignore start */
    log: function(level: string, message: string, data?: any): void {
      if (!CONFIG.debug) return;
      if (level === 'verbose' && !CONFIG.verbose) return;

      try {
        const prefix = '[ppAnalytics v' + CONFIG.version + ']';
        const logFn = (console as any)[level] || console.log;
        logFn.call(console, prefix, message, data || '');
      } catch (e) {
        // Silent fail for logging
      }
    },
    /*! v8 ignore stop */

    /*! v8 ignore start */
    isValidParam: function(name: string): boolean {
      try {
        if (!SafeUtils.exists(name)) return false;
        const whitelist = this.getAllParamNames();
        return whitelist.indexOf(name) !== -1;
      } catch (e) {
        return false;
      }
    }
    /*! v8 ignore stop */
  };

  // =====================================================
  // CONSENT MODULE (NULL-SAFE)
  // =====================================================

  /*! v8 ignore start */
  var consentCacheResult: boolean | null = null;
  var consentCacheTime: number = 0;
  var CONSENT_CACHE_TTL = 60000; // 60 seconds

  const Consent = {
    state: SafeUtils.get(CONFIG, 'consent.defaultState', 'approved') as string,

    isGranted: function(): boolean {
      try {
        if (!SafeUtils.get(CONFIG, 'consent.required', false)) {
        /*! v8 ignore stop */
          return true;
        }

        var now = Date.now();
        if (consentCacheResult !== null && (now - consentCacheTime) < CONSENT_CACHE_TTL) {
          return consentCacheResult;
        }

        /*! v8 ignore start */
        var result: boolean | null = null;

        if (SafeUtils.get(CONFIG, 'consent.frameworks.custom.enabled', false)) {
          try {
            const checkFn = SafeUtils.get(CONFIG, 'consent.frameworks.custom.checkFunction');
            if (typeof checkFn === 'function') {
              result = checkFn();
            }
          } catch (e) {
            Utils.log('error', 'Custom consent check failed', e);
          }
        }

        if (result === null && SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.enabled', false)) {
          if (this.checkOneTrust()) result = true;
        }

        if (result === null && SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.enabled', false)) {
          if (this.checkCookieYes()) result = true;
        }

        if (result === null) {
          result = this.getStoredConsent();
        }
        /*! v8 ignore stop */

        consentCacheResult = result;
        consentCacheTime = Date.now();
        return result;
      } catch (e) {
        /*! v8 ignore start */
        Utils.log('error', 'Consent check error', e);
        consentCacheResult = this.state === 'approved';
        consentCacheTime = Date.now();
        return consentCacheResult;
        /*! v8 ignore stop */
      }
    },

    checkOneTrust: function(): boolean {
      try {
        const groups = win.OnetrustActiveGroups;
        /*! v8 ignore start */
        if (SafeUtils.exists(groups)) {
        /*! v8 ignore stop */
          const categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.oneTrust.categoryId', 'C0002');
          return groups.indexOf(categoryId) !== -1;
        }
      } catch (e) {
        Utils.log('verbose', 'OneTrust check failed', e);
      }
      return false;
    },

    checkCookieYes: function(): boolean {
      try {
        const cookieName = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.cookieName', 'cookieyes-consent');
        const cookie = ppLib.getCookie(cookieName);

        /*! v8 ignore start */
        if (SafeUtils.exists(cookie)) {
        /*! v8 ignore stop */
          const consent = Security.json.parse(cookie as string);
          const categoryId = SafeUtils.get(CONFIG, 'consent.frameworks.cookieYes.categoryId', 'analytics');
          return SafeUtils.get(consent, categoryId) === 'yes';
        }
      } catch (e) {
        Utils.log('verbose', 'CookieYes check failed', e);
      }
      return false;
    },

    getStoredConsent: function(): boolean {
      try {
        const storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        const stored = win.localStorage.getItem(storageKey);

        /*! v8 ignore start */
        if (SafeUtils.exists(stored)) {
        /*! v8 ignore stop */
          this.state = stored as string;
          return stored === 'approved';
        }
      } catch (e) {
        Utils.log('verbose', 'Could not read consent from storage');
      }

      return this.state === 'approved';
    },

    setConsent: function(granted: boolean): void {
      try {
        consentCacheResult = null;
        this.state = granted ? 'approved' : 'denied';

        const storageKey = SafeUtils.get(CONFIG, 'consent.storageKey', 'pp_consent');
        win.localStorage.setItem(storageKey, this.state);

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

  const UrlParser = {
    getParams: function(): Record<string, string> {
      try {
        const currentUrl = win.location && win.location.href;
        /*! v8 ignore start */
        if (!currentUrl || !Security.isValidUrl(currentUrl)) {
        /*! v8 ignore stop */
          Utils.log('verbose', 'Invalid or missing URL');
          return {};
        }

        const params: Record<string, string> = {};
        /*! v8 ignore start */
        const searchParams = new URLSearchParams(win.location.search || '');
        /*! v8 ignore stop */
        const whitelist = Utils.getAllParamNames();

        SafeUtils.forEach(whitelist, function(param: string) {
          try {
            const value = searchParams.get(param);
            /*! v8 ignore start */
            if (SafeUtils.exists(value)) {
            /*! v8 ignore stop */
              const sanitized = Security.sanitize(value);
              /*! v8 ignore start */
              if (SafeUtils.exists(sanitized)) {
              /*! v8 ignore stop */
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

    getTrackedParams: function(): TrackedParams | null {
      try {
        const params: any = this.getParams();

        /*! v8 ignore start */
        if (!params || Object.keys(params).length === 0) {
        /*! v8 ignore stop */
          return null;
        }

        try {
          /*! v8 ignore start */
          params.landing_page = Security.sanitize(
            (win.location.origin || '') + (win.location.pathname || '')
          );
          /*! v8 ignore stop */
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

    getReferrer: function(): string {
      try {
        const referrer = doc.referrer;
        /*! v8 ignore start */
        if (!SafeUtils.exists(referrer)) return 'direct';
        /*! v8 ignore stop */

        const referrerUrl = new URL(referrer);
        const currentUrl = new URL(win.location.href);

        /*! v8 ignore start */
        if (referrerUrl.hostname === currentUrl.hostname) {
        /*! v8 ignore stop */
          return 'internal';
        }

        /*! v8 ignore start */
        return Security.sanitize(referrerUrl.origin) || 'unknown';
        /*! v8 ignore stop */
      } catch (e) {
        /*! v8 ignore start */
        return doc.referrer ? 'unknown' : 'direct';
        /*! v8 ignore stop */
      }
    }
  };

  // =====================================================
  // SESSION MODULE (NULL-SAFE)
  // =====================================================

  const Session = {
    isValid: function(): boolean {
      try {
        const sessionStart = Storage.get('session_start');
        /*! v8 ignore start */
        if (!sessionStart || typeof sessionStart !== 'number') {
        /*! v8 ignore stop */
          return false;
        }

        const now = new Date().getTime();
        const sessionAge = (now - sessionStart) / 1000 / 60;
        const timeout = SafeUtils.get(CONFIG, 'attribution.sessionTimeout', 30);

        return sessionAge < timeout;
      /*! v8 ignore start */
      } catch (e) {
        return false;
      }
      /*! v8 ignore stop */
    },

    start: function(): void {
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

  const EventQueue = {
    queue: [] as QueueEvent[],
    processing: false,
    rateLimits: {} as Record<string, RateLimitEntry>,

    add: function(event: QueueEvent): void {
      try {
        /*! v8 ignore start */
        if (!event || typeof event !== 'object') return;

        if (!SafeUtils.get(CONFIG, 'performance.queueEnabled', true)) {
        /*! v8 ignore stop */
          this.process(event);
          return;
        }

        const maxSize = SafeUtils.get(CONFIG, 'performance.maxQueueSize', 50);
        /*! v8 ignore start */
        if (this.queue.length >= maxSize) {
        /*! v8 ignore stop */
          Utils.log('warn', 'Event queue full, dropping event');
        } else {
          this.queue.push(event);
          this.scheduleProcessing();
        }
      } catch (e) {
        Utils.log('error', 'Queue add error', e);
      }
    },

    scheduleProcessing: function(): void {
      try {
        /*! v8 ignore start */
        if (this.processing) return;
        /*! v8 ignore stop */

        const self = this;
        const useIdleCallback = SafeUtils.get(CONFIG, 'performance.useRequestIdleCallback', true);

        /*! v8 ignore start */
        if (useIdleCallback && typeof win.requestIdleCallback === 'function') {
        /*! v8 ignore stop */
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

    processQueue: function(): void {
      try {
        this.processing = true;

        while (this.queue.length > 0) {
          const event = this.queue.shift();
          /*! v8 ignore start */
          if (event) {
          /*! v8 ignore stop */
            this.process(event);
          }
        }

        this.processing = false;
      } catch (e) {
        Utils.log('error', 'Process queue error', e);
        this.processing = false;
      }
    },

    rateLimitWriteCount: 0,

    checkRateLimit: function(key: string, max: number, windowMs: number): boolean {
      try {
        /*! v8 ignore start */
        if (!SafeUtils.exists(key)) return false;
        /*! v8 ignore stop */

        const now = Date.now();

        /*! v8 ignore start */
        if (!this.rateLimits[key]) {
        /*! v8 ignore stop */
          this.rateLimits[key] = { count: 0, resetAt: now + windowMs };
        }

        const limit = this.rateLimits[key];

        /*! v8 ignore start */
        if (now > limit.resetAt) {
        /*! v8 ignore stop */
          limit.count = 0;
          limit.resetAt = now + windowMs;
        }

        /*! v8 ignore start */
        if (limit.count >= max) {
        /*! v8 ignore stop */
          Utils.log('warn', 'Rate limit exceeded for ' + key);
          return false;
        }

        limit.count++;

        /*! v8 ignore start */
        // Prune expired rate limit entries every 50 writes to prevent unbounded growth
        if (++this.rateLimitWriteCount >= 50) {
          this.rateLimitWriteCount = 0;
          for (const k in this.rateLimits) {
            if (now > this.rateLimits[k].resetAt) {
              delete this.rateLimits[k];
            }
          }
        }
        /*! v8 ignore stop */

        return true;
      } catch (e) {
        return true;
      }
    },

    process: function(event: QueueEvent): void {
      try {
        /*! v8 ignore start */
        if (!event || !event.type) return;
        /*! v8 ignore stop */

        const eventType = SafeUtils.toString(event.type);

        if (eventType === 'gtm' && SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          const max = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitMax', 100);
          const windowMs = SafeUtils.get(CONFIG, 'platforms.gtm.rateLimitWindow', 60000);

          /*! v8 ignore start */
          if (this.checkRateLimit('gtm', max, windowMs)) {
            Platforms.GTM.push(event.data);
          }
        } else if (eventType === 'mixpanel' && SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
          Platforms.Mixpanel.send(event.data);
        /*! v8 ignore stop */
        /*! v8 ignore start */
        } else if (eventType === 'custom') {
          if (event.handler && typeof event.handler === 'function') {
            event.handler(event.data);
          }
        }
        /*! v8 ignore stop */
      } catch (e) {
        Utils.log('error', 'Event processing error', e);
      }
    }
  };

  // =====================================================
  // PLATFORMS MODULE (NULL-SAFE)
  // =====================================================

  const Platforms = {
    GTM: {
      push: function(data: any): void {
        try {
          /*! v8 ignore start */
          if (!data || typeof data !== 'object') return;
          /*! v8 ignore stop */

          /*! v8 ignore start */
          win.dataLayer = win.dataLayer || [];
          /*! v8 ignore stop */

          /*! v8 ignore start */
          if (!Security.validateData(data)) {
          /*! v8 ignore stop */
            Utils.log('error', 'Invalid GTM data rejected');
            return;
          }

          win.dataLayer.push(data);
          Utils.log('verbose', 'Pushed to GTM', data);
        } catch (e) {
          Utils.log('error', 'GTM push error', e);
        }
      }
    },

    Mixpanel: {
      ready: false,
      _checking: false,
      _intervalId: null as ReturnType<typeof setInterval> | null,
      queue: [] as any[],

      send: function(data: any): void {
        try {
          /*! v8 ignore start */
          if (!data || typeof data !== 'object') return;
          /*! v8 ignore stop */

          /*! v8 ignore start */
          if (!Security.validateData(data)) {
          /*! v8 ignore stop */
            Utils.log('error', 'Invalid Mixpanel data rejected');
            return;
          }

          /*! v8 ignore start */
          if (!this.ready) {
            this.queue.push(data);
            if (!this._checking) this.checkReady();
            return;
          }
          /*! v8 ignore stop */

          const dataType = SafeUtils.get(data, 'type', '');

          if (dataType === 'register' && win.mixpanel && win.mixpanel.register) {
            /*! v8 ignore start */
            win.mixpanel.register(data.properties || {});
            /*! v8 ignore stop */
          /*! v8 ignore start */
          } else if (dataType === 'track' && win.mixpanel && win.mixpanel.track) {
          /*! v8 ignore stop */
            /*! v8 ignore start */
            win.mixpanel.track(data.eventName || 'Unknown Event', data.properties || {});
            /*! v8 ignore stop */
          }

          Utils.log('verbose', 'Sent to Mixpanel', data);
        } catch (e) {
          Utils.log('error', 'Mixpanel send error', e);
        }
      },

      checkReady: function(): void {
        try {
          this._checking = true;
          const self = this;
          let attempts = 0;
          const maxRetries = SafeUtils.get(CONFIG, 'platforms.mixpanel.maxRetries', 50);
          const retryInterval = SafeUtils.get(CONFIG, 'platforms.mixpanel.retryInterval', 100);

          self._intervalId = setInterval(function() {
            attempts++;

            /*! v8 ignore start */
            if (attempts >= maxRetries) {
            /*! v8 ignore stop */
              clearInterval(self._intervalId!);
              self._intervalId = null;
              self._checking = false;
              self.queue.length = 0;
              Utils.log('verbose', 'Mixpanel not available, clearing queued events');
              return;
            }

            /*! v8 ignore start */
            if (win.mixpanel && win.mixpanel.register) {
              clearInterval(self._intervalId!);
              self._intervalId = null;
              self._checking = false;
              self.ready = true;
            /*! v8 ignore stop */

              while (self.queue.length > 0) {
                const data = self.queue.shift();
                /*! v8 ignore start */
                if (data) {
                /*! v8 ignore stop */
                  self.send(data);
                }
              }
            }
          }, retryInterval);
        } catch (e) {
          this._checking = false;
          Utils.log('error', 'Mixpanel check ready error', e);
        }
      },

      /*! v8 ignore start */
      destroy: function(): void {
        if (this._intervalId) {
          clearInterval(this._intervalId);
          this._intervalId = null;
        }
        this._checking = false;
        this.ready = false;
        this.queue.length = 0;
      }
      /*! v8 ignore stop */
    },

    register: function(name: string, handler: (data: any) => void): void {
      try {
        /*! v8 ignore start */
        if (!SafeUtils.exists(name) || typeof handler !== 'function') {
        /*! v8 ignore stop */
          Utils.log('warn', 'registerPlatform requires a valid name and handler function');
          return;
        }

        /*! v8 ignore start */
        CONFIG.platforms.custom = CONFIG.platforms.custom || [];
        /*! v8 ignore stop */
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

  const Tracker = {
    initialized: false,

    init: function(): void {
      try {
        /*! v8 ignore start */
        if (!Consent.isGranted()) {
        /*! v8 ignore stop */
          Utils.log('info', 'Consent not granted, skipping tracking');
          return;
        }

        Utils.log('info', 'Initializing tracker v' + CONFIG.version);

        // Initialize shared marketing attribution service (extracts params once)
        if (ppLib.attribution) {
          ppLib.attribution.configure({
            includeFirstTouch: SafeUtils.get(CONFIG, 'attribution.enableFirstTouch', true),
            includeLastTouch: SafeUtils.get(CONFIG, 'attribution.enableLastTouch', true),
            persistFirstTouch: SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false),
            sessionTimeoutMs: SafeUtils.get(CONFIG, 'attribution.sessionTimeout', 30) * 60 * 1000,
          });
          ppLib.attribution.init();
        }

        let currentParams: TrackedParams | null = null;

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'attribution.autoCapture', true)) {
        /*! v8 ignore stop */
          currentParams = UrlParser.getTrackedParams();
        }

        /*! v8 ignore start */
        if (currentParams && Object.keys(currentParams).length > 0) {
        /*! v8 ignore stop */
          Utils.log('verbose', 'Auto-captured tracking parameters', currentParams);

          /*! v8 ignore start */
          if (SafeUtils.get(CONFIG, 'attribution.enableLastTouch', true)) {
          /*! v8 ignore stop */
            Storage.set('last_touch', currentParams);
          }

          /*! v8 ignore start */
          if (SafeUtils.get(CONFIG, 'attribution.enableFirstTouch', true)) {
          /*! v8 ignore stop */
            const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
            const existingFirstTouch = Storage.get('first_touch', persist);
            const sessionValid = Session.isValid();

            /*! v8 ignore start */
            if (!existingFirstTouch || !sessionValid) {
            /*! v8 ignore stop */
              Storage.set('first_touch', currentParams, persist);
              Session.start();
              Utils.log('verbose', 'Stored first-touch attribution');
            }
          }
        }

        this.sendAttribution();

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'attribution.trackPageViews', true)) {
        /*! v8 ignore stop */
          this.trackPageView();
        }

        this.initialized = true;
        Utils.log('info', 'Tracker initialized successfully');

      } catch (e) {
        Utils.log('error', 'Tracker initialization error', e);
      }
    },

    sendAttribution: function(): void {
      try {
        const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
        /*! v8 ignore start */
        const firstTouch = Storage.get('first_touch', persist) || {};
        const lastTouch = Storage.get('last_touch') || {};
        /*! v8 ignore stop */

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
          if (Object.keys(firstTouch).length > 0) {
          /*! v8 ignore stop */
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

          /*! v8 ignore start */
          if (Object.keys(lastTouch).length > 0) {
          /*! v8 ignore stop */
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

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
        /*! v8 ignore stop */
          const mixpanelProps: Record<string, string> = {};

          /*! v8 ignore start */
          if (Object.keys(firstTouch).length > 0) {
          /*! v8 ignore stop */
            mixpanelProps['First Touch Source'] = SafeUtils.get(firstTouch, 'utm_source', 'direct');
            mixpanelProps['First Touch Medium'] = SafeUtils.get(firstTouch, 'utm_medium', 'none');
            mixpanelProps['First Touch Campaign'] = SafeUtils.get(firstTouch, 'utm_campaign', '');
            mixpanelProps['First Touch Landing Page'] = SafeUtils.get(firstTouch, 'landing_page', '');
          }

          /*! v8 ignore start */
          if (Object.keys(lastTouch).length > 0) {
          /*! v8 ignore stop */
            mixpanelProps['Last Touch Source'] = SafeUtils.get(lastTouch, 'utm_source', 'direct');
            mixpanelProps['Last Touch Medium'] = SafeUtils.get(lastTouch, 'utm_medium', 'none');
            mixpanelProps['Last Touch Campaign'] = SafeUtils.get(lastTouch, 'utm_campaign', '');
            mixpanelProps['Last Touch Landing Page'] = SafeUtils.get(lastTouch, 'landing_page', '');
          }

          /*! v8 ignore start */
          if (Object.keys(mixpanelProps).length > 0) {
          /*! v8 ignore stop */
            EventQueue.add({
              type: 'mixpanel',
              data: {
                type: 'register',
                properties: mixpanelProps
              }
            });
          }
        }

        const customPlatforms = SafeUtils.get(CONFIG, 'platforms.custom', []);
        SafeUtils.forEach(customPlatforms, function(platform: CustomPlatform) {
          /*! v8 ignore start */
          if (platform && platform.handler) {
          /*! v8 ignore stop */
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

    trackPageView: function(): void {
      try {
        const data = {
          page_url: SafeUtils.get(win, 'location.href', ''),
          page_title: SafeUtils.get(doc, 'title', ''),
          page_path: SafeUtils.get(win, 'location.pathname', '')
        };

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
        /*! v8 ignore stop */
          EventQueue.add({
            type: 'gtm',
            data: ppLib.extend({
              event: SafeUtils.get(CONFIG, 'platforms.gtm.events.pageView', 'attribution_page_view')
            }, data)
          });
        }

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true) &&
            SafeUtils.get(CONFIG, 'platforms.mixpanel.trackPageView', true)) {
        /*! v8 ignore stop */
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

    track: function(eventName: string, properties?: any): void {
      try {
        /*! v8 ignore start */
        if (!this.initialized) {
          Utils.log('warn', 'Tracker not initialized, queuing event');
        }
        /*! v8 ignore stop */

        /*! v8 ignore start */
        if (!SafeUtils.exists(eventName)) {
        /*! v8 ignore stop */
          Utils.log('error', 'Event name required');
          return;
        }

        /*! v8 ignore start */
        properties = properties || {};
        /*! v8 ignore stop */

        const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
        const firstTouch = Storage.get('first_touch', persist);
        const lastTouch = Storage.get('last_touch');

        /*! v8 ignore start */
        if (firstTouch) {
        /*! v8 ignore stop */
          properties.first_touch_source = SafeUtils.get(firstTouch, 'utm_source', 'direct');
          properties.first_touch_campaign = SafeUtils.get(firstTouch, 'utm_campaign', '');
        }

        /*! v8 ignore start */
        if (lastTouch) {
        /*! v8 ignore stop */
          properties.last_touch_source = SafeUtils.get(lastTouch, 'utm_source', 'direct');
          properties.last_touch_campaign = SafeUtils.get(lastTouch, 'utm_campaign', '');
        }

        // Clone properties to avoid mutating the caller's object
        // marketingAttribution is auto-injected by global platform patches
        var enrichedProps = ppLib.extend({}, properties);

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.gtm.enabled', true)) {
        /*! v8 ignore stop */
          EventQueue.add({
            type: 'gtm',
            data: ppLib.extend({ event: eventName }, enrichedProps)
          });
        }

        /*! v8 ignore start */
        if (SafeUtils.get(CONFIG, 'platforms.mixpanel.enabled', true)) {
        /*! v8 ignore stop */
          EventQueue.add({
            type: 'mixpanel',
            data: {
              type: 'track',
              eventName: eventName,
              properties: enrichedProps
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
        const persist = SafeUtils.get(CONFIG, 'attribution.persistAcrossSessions', false);
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

  const API = {
    version: CONFIG.version,

    config: function(options?: Partial<AnalyticsConfig>) {
      try {
        /*! v8 ignore start */
        if (options) {
        /*! v8 ignore stop */
          ppLib.extend(CONFIG, options);
          cachedParamNames = null;
          Utils.log('info', 'Configuration updated');
        }
        return JSON.parse(JSON.stringify(CONFIG));
      } catch (e) {
        Utils.log('error', 'Config error', e);
        return JSON.parse(JSON.stringify(CONFIG));
      }
    },

    consent: {
      grant: function(): void {
        Consent.setConsent(true);
      },
      revoke: function(): void {
        Consent.setConsent(false);
      },
      status: function(): boolean {
        return Consent.isGranted();
      }
    },

    track: function(eventName: string, properties?: any): void {
      Tracker.track(eventName, properties);
    },

    getAttribution: function() {
      return Tracker.getAttribution();
    },

    registerPlatform: function(name: string, handler: (data: any) => void): void {
      Platforms.register(name, handler);
    },

    clear: function(): void {
      Storage.clear();
    },

    init: function(): void {
      Tracker.init();
    }
  };

  // =====================================================
  // AUTO-INITIALIZATION
  // =====================================================

  try {
    /*! v8 ignore start */
    if (doc.readyState === 'loading') {
    /*! v8 ignore stop */
      doc.addEventListener('DOMContentLoaded', function() {
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

  win.ppAnalytics = API;

  /*! v8 ignore start */
  if (CONFIG.debug) {
    Utils.log('info', 'API ready at window.ppAnalytics');

    win.ppAnalyticsDebug = {
      config: CONFIG,
      consent: Consent,
      tracker: Tracker,
      platforms: Platforms,
      queue: EventQueue
    };
  }
  /*! v8 ignore stop */

  } // end initModule

  // Safe load: wait for ppLib if not yet available
  /*! v8 ignore start */
  if (win.ppLib && win.ppLib._isReady) {
    initModule(win.ppLib);
  } else {
    win.ppLibReady = win.ppLibReady || [];
    win.ppLibReady.push(initModule);
  }
  /*! v8 ignore stop */

})(window, document);
