/**
 * pp-analytics-lib: Mixpanel Module
 * Mixpanel SDK loader, session management, UTM attribution, and identity.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.mixpanel
 */
import type { PPLib } from '../types/common.types';
import type { MixpanelConfig } from '../types/mixpanel.types';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {

  // =====================================================
  // CONFIGURATION (overridable via ppLib.mixpanel.configure)
  // =====================================================

  const CONFIG: MixpanelConfig = {
    enabled: true,
    token: '',
    projectName: '',
    crossSubdomainCookie: false,
    optOutByDefault: false,
    sessionTimeout: 1800000, // 30 minutes in ms
    cookieNames: {
      userId: 'userId',
      ipAddress: 'ipAddress',
      experiments: 'exp'
    }
  };

  // =====================================================
  // MIXPANEL SDK LOADER
  // =====================================================

  function loadMixpanelSDK(): void {
    /*! v8 ignore start */
    if ((win as any).mixpanel && (win as any).mixpanel.__SV) return;
    /*! v8 ignore stop */

    var c: any = doc;
    /*! v8 ignore start */
    var a: any = (win as any).mixpanel || [];

    if (!a.__SV) {
    /*! v8 ignore stop */
      var b: any = win;
      try {
        var d: any, m: any, j: any, k = b.location, f = k.hash;
        d = function(a: any, b: any) {
          return (m = a.match(RegExp(b + '=([^&]*)'))) ? m[1] : null;
        };
        f && d(f, 'state') &&
          ((j = JSON.parse(decodeURIComponent(d(f, 'state')))),
          'mpeditor' === j.action &&
            (b.sessionStorage.setItem('_mpcehash', f),
            history.replaceState(j.desiredHash || '', c.title, k.pathname + k.search)));
      } catch (n) {}

      var l: any, h: any;
      (win as any).mixpanel = a;
      a._i = [];
      a.init = function(b: any, d: any, g: any) {
        function c(b: any, i: any) {
          var a = i.split('.');
          2 == a.length && ((b = b[a[0]]), (i = a[1]));
          b[i] = function() {
            b.push([i].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        var e = a;
        'undefined' !== typeof g ? (e = a[g] = []) : (g = 'mixpanel');
        e.people = e.people || [];
        e.toString = function(b: any) {
          var a = 'mixpanel';
          'mixpanel' !== g && (a += '.' + g);
          b || (a += ' (stub)');
          return a;
        };
        e.people.toString = function() {
          return e.toString(1) + '.people (stub)';
        };
        l = 'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(' ');
        for (h = 0; h < l.length; h++) c(e, l[h]);
        var f = 'set set_once union unset remove delete'.split(' ');
        e.get_group = function() {
          function a(c: any) {
            b[c] = function() {
              call2_args = arguments;
              call2 = [c].concat(Array.prototype.slice.call(call2_args, 0));
              e.push([d, call2]);
            };
          }
          for (
            var b: any = {},
              d = ['get_group'].concat(Array.prototype.slice.call(arguments, 0)),
              call2_args: any,
              call2: any,
              c = 0;
            c < f.length;
            c++
          ) a(f[c]);
          return b;
        };
        a._i.push([b, d, g]);
      };
      a.__SV = 1.2;
      b = c.createElement('script');
      b.type = 'text/javascript';
      b.async = !0;
      b.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
      d = c.getElementsByTagName('script')[0];
      d.parentNode.insertBefore(b, d);
    }
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  let mixpanel: any;

  const SessionManager = {
    timeout: CONFIG.sessionTimeout,

    generateId: function(): string {
      function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
          .toString(16)
          .substring(1);
      }
      return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    },

    setId: function(): void {
      mixpanel.register({ 'session ID': this.generateId() });
    },

    check: function(): void {
      /*! v8 ignore start */
      if (!mixpanel.get_property('last event time')) {
      /*! v8 ignore stop */
        this.setId();
      }
      /*! v8 ignore start */
      if (!mixpanel.get_property('session ID')) {
      /*! v8 ignore stop */
        this.setId();
      }
      /*! v8 ignore start */
      if (Date.now() - mixpanel.get_property('last event time') > this.timeout) {
      /*! v8 ignore stop */
        this.setId();
        resetCampaign();
      }
    }
  };

  // =====================================================
  // CAMPAIGN / UTM ATTRIBUTION
  // =====================================================

  const CAMPAIGN_KEYWORDS = 'utm_source utm_medium utm_campaign utm_content utm_term'.split(' ');

  function resetCampaign(): void {
    const params: Record<string, string> = {};
    for (let i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
      params[CAMPAIGN_KEYWORDS[i] + ' [last touch]'] = '$direct';
    }
    mixpanel.people.set(params);
    mixpanel.register(params);
  }

  function checkIfUtmParamsPresent(url: string): boolean {
    for (let i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
      /*! v8 ignore start */
      if (ppLib.getQueryParam(url, CAMPAIGN_KEYWORDS[i]).length) return true;
      /*! v8 ignore stop */
    }
    return false;
  }

  function campaignParams(): void {
    let kw = '';
    const lastParams: Record<string, string> = {};
    const firstParams: Record<string, string> = {};
    const url = doc.URL;

    /*! v8 ignore start */
    if (checkIfUtmParamsPresent(url)) {
    /*! v8 ignore stop */
      for (let i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
        kw = ppLib.getQueryParam(url, CAMPAIGN_KEYWORDS[i]);
        if (kw.length) {
          lastParams[CAMPAIGN_KEYWORDS[i] + ' [last touch]'] = kw;
          firstParams[CAMPAIGN_KEYWORDS[i] + ' [first touch]'] = kw;
        } else {
          lastParams[CAMPAIGN_KEYWORDS[i] + ' [last touch]'] = '';
          firstParams[CAMPAIGN_KEYWORDS[i] + ' [first touch]'] = '';
        }
      }
    }

    const gclid = ppLib.getQueryParam(url, 'gclid');
    /*! v8 ignore start */
    if (gclid.length) {
    /*! v8 ignore stop */
      lastParams['gclid'] = gclid;
    }

    const fbclid = ppLib.getQueryParam(url, 'fbclid');
    /*! v8 ignore start */
    if (fbclid.length) {
    /*! v8 ignore stop */
      lastParams['fbclid'] = fbclid;
    }

    mixpanel.people.set(lastParams);
    mixpanel.people.set_once(firstParams);
    mixpanel.register(lastParams);
    mixpanel.register_once(firstParams);
  }

  // =====================================================
  // MIXPANEL COOKIE DATA READER
  // =====================================================

  function getMixpanelCookieData(): Record<string, any> {
    let mixpanelData: Record<string, any> = {};
    const regex = /^mp_([a-zA-Z0-9]+)_mixpanel$/i;

    try {
      doc.cookie.split(/\s*;\s*/).forEach(function(pair: string) {
        const parts = pair.split(/\s*=\s*/);
        const name = decodeURIComponent(parts[0]);
        /*! v8 ignore start */
        if (regex.test(name)) {
        /*! v8 ignore stop */
          const value = decodeURIComponent(parts.splice(1).join('='));
          mixpanelData = ppLib.Security.json.parse(value, {});
        }
      });
    } catch (e) {
      ppLib.log('error', 'getMixpanelCookieData error', e);
    }

    return mixpanelData;
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  function initMixpanel(): void {
    /*! v8 ignore start */
    if (!CONFIG.enabled) {
    /*! v8 ignore stop */
      ppLib.log('info', '[ppMixpanel] Module disabled via config');
      return;
    }

    /*! v8 ignore start */
    if (!CONFIG.token) {
    /*! v8 ignore stop */
      ppLib.log('warn', '[ppMixpanel] No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.');
      return;
    }

    loadMixpanelSDK();
    mixpanel = (win as any).mixpanel;

    mixpanel.init(CONFIG.token, {
      cross_subdomain_cookie: CONFIG.crossSubdomainCookie,
      opt_out_tracking_by_default: CONFIG.optOutByDefault,
      api_transport: 'sendBeacon',
      loaded: function(mp: any) {
        mixpanel = mp;
        mp.opt_in_tracking();

        // Update session timeout from config
        SessionManager.timeout = CONFIG.sessionTimeout;

        // Check/set session
        SessionManager.check();

        // Monkey-patch track() to always check session.
        // Uses stored original to prevent wrapper nesting across re-inits.
        var originalTrack = mp.track._ppOriginal || mp.track;
        mp.track = function() {
          SessionManager.check();
          mp.register({ 'last event time': Date.now() });
          originalTrack.apply(mp, arguments);
        };
        mp.track._ppOriginal = originalTrack;
        ppLib._mpTrackPatched = true;

        // Register base properties
        const baseProps: Record<string, any> = {
          'last event time': Date.now(),
          pp_user_agent: win.navigator.userAgent
        };

        /*! v8 ignore start */
        if (CONFIG.projectName) {
        /*! v8 ignore stop */
          baseProps.project = CONFIG.projectName;
        }

        mp.register(baseProps);

        // Cookie-based identity
        const userId = ppLib.getCookie(CONFIG.cookieNames.userId);
        /*! v8 ignore start */
        if (userId) {
        /*! v8 ignore stop */
          mp.register({ pp_user_id: userId });
        }

        const ipAddress = ppLib.getCookie(CONFIG.cookieNames.ipAddress);
        /*! v8 ignore start */
        if (ipAddress) {
        /*! v8 ignore stop */
          mp.register({ pp_user_ip: ipAddress });
        }

        // Experiment cookie
        const expCookie = ppLib.getCookie(CONFIG.cookieNames.experiments);
        /*! v8 ignore start */
        if (expCookie) {
        /*! v8 ignore stop */
          const expJson = ppLib.Security.json.parse(expCookie);
          /*! v8 ignore start */
          if (expJson && typeof expJson === 'object') {
          /*! v8 ignore stop */
            const data: Record<string, any> = {};
            Object.keys(expJson).forEach(function(item: string) {
              data[item] = expJson[item];
            });
            mp.people.set_once(data);
            mp.register(data);
          }
        }

        // UTM attribution
        campaignParams();

        ppLib.log('info', '[ppMixpanel] Initialized successfully');
      }
    });
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  ppLib.mixpanel = {
    configure: function(options?: Partial<MixpanelConfig>) {
      /*! v8 ignore start */
      if (options) {
      /*! v8 ignore stop */
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: function(): void {
      initMixpanel();
    },

    getMixpanelCookieData: getMixpanelCookieData,

    getConfig: function() {
      return Object.assign({}, CONFIG);
    }
  };

  ppLib.log('info', '[ppMixpanel] Module loaded');

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
