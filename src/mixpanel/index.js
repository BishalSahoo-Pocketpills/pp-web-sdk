/**
 * pp-analytics-lib: Mixpanel Module v1.0.0
 * Mixpanel SDK loader, session management, UTM attribution, and identity.
 *
 * Requires: common.js (window.ppLib)
 * Exposes: window.ppLib.mixpanel
 */
(function(window, document, undefined) {
  'use strict';

  function initModule(ppLib) {

  // =====================================================
  // CONFIGURATION (overridable via ppLib.mixpanel.configure)
  // =====================================================

  var CONFIG = {
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

  function loadMixpanelSDK() {
    if (window.mixpanel && window.mixpanel.__SV) return;

    var c = document;
    var a = window.mixpanel || [];

    if (!a.__SV) {
      var b = window;
      try {
        var d, m, j, k = b.location, f = k.hash;
        d = function(a, b) {
          return (m = a.match(RegExp(b + '=([^&]*)'))) ? m[1] : null;
        };
        f && d(f, 'state') &&
          ((j = JSON.parse(decodeURIComponent(d(f, 'state')))),
          'mpeditor' === j.action &&
            (b.sessionStorage.setItem('_mpcehash', f),
            history.replaceState(j.desiredHash || '', c.title, k.pathname + k.search)));
      } catch (n) {}

      var l, h;
      window.mixpanel = a;
      a._i = [];
      a.init = function(b, d, g) {
        function c(b, i) {
          var a = i.split('.');
          2 == a.length && ((b = b[a[0]]), (i = a[1]));
          b[i] = function() {
            b.push([i].concat(Array.prototype.slice.call(arguments, 0)));
          };
        }
        var e = a;
        'undefined' !== typeof g ? (e = a[g] = []) : (g = 'mixpanel');
        e.people = e.people || [];
        e.toString = function(b) {
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
          function a(c) {
            b[c] = function() {
              call2_args = arguments;
              call2 = [c].concat(Array.prototype.slice.call(call2_args, 0));
              e.push([d, call2]);
            };
          }
          for (
            var b = {},
              d = ['get_group'].concat(Array.prototype.slice.call(arguments, 0)),
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
      b.src = '//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
      d = c.getElementsByTagName('script')[0];
      d.parentNode.insertBefore(b, d);
    }
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  var SessionManager = {
    timeout: CONFIG.sessionTimeout,

    generateId: function() {
      function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
          .toString(16)
          .substring(1);
      }
      return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    },

    setId: function() {
      mixpanel.register({ 'session ID': this.generateId() });
    },

    check: function() {
      if (!mixpanel.get_property('last event time')) {
        this.setId();
      }
      if (!mixpanel.get_property('session ID')) {
        this.setId();
      }
      if (Date.now() - mixpanel.get_property('last event time') > this.timeout) {
        this.setId();
        resetCampaign();
      }
    }
  };

  // =====================================================
  // CAMPAIGN / UTM ATTRIBUTION
  // =====================================================

  var CAMPAIGN_KEYWORDS = 'utm_source utm_medium utm_campaign utm_content utm_term'.split(' ');

  function resetCampaign() {
    var params = {};
    for (var i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
      params[CAMPAIGN_KEYWORDS[i] + ' [last touch]'] = '$direct';
    }
    mixpanel.people.set(params);
    mixpanel.register(params);
  }

  function checkIfUtmParamsPresent(url) {
    for (var i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
      if (ppLib.getQueryParam(url, CAMPAIGN_KEYWORDS[i]).length) return true;
    }
    return false;
  }

  function campaignParams() {
    var kw = '';
    var lastParams = {};
    var firstParams = {};
    var url = document.URL;

    if (checkIfUtmParamsPresent(url)) {
      for (var i = 0; i < CAMPAIGN_KEYWORDS.length; i++) {
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

    var gclid = ppLib.getQueryParam(url, 'gclid');
    if (gclid.length) {
      lastParams['gclid'] = gclid;
    }

    var fbclid = ppLib.getQueryParam(url, 'fbclid');
    if (fbclid.length) {
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

  function getMixpanelCookieData() {
    var mixpanelData = {};
    var regex = /^mp_([a-zA-Z0-9]+)_mixpanel$/i;

    try {
      document.cookie.split(/\s*;\s*/).forEach(function(pair) {
        pair = pair.split(/\s*=\s*/);
        var name = decodeURIComponent(pair[0]);
        if (regex.test(name)) {
          var value = decodeURIComponent(pair.splice(1).join('='));
          mixpanelData = JSON.parse(value);
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

  function initMixpanel() {
    if (!CONFIG.token) {
      ppLib.log('warn', '[ppMixpanel] No token configured. Call ppLib.mixpanel.configure({ token: "..." }) before init.');
      return;
    }

    loadMixpanelSDK();

    mixpanel.init(CONFIG.token, {
      cross_subdomain_cookie: CONFIG.crossSubdomainCookie,
      opt_out_tracking_by_default: CONFIG.optOutByDefault,
      api_transport: 'sendBeacon',
      loaded: function(mixpanel) {
        mixpanel.opt_in_tracking();

        // Update session timeout from config
        SessionManager.timeout = CONFIG.sessionTimeout;

        // Check/set session
        SessionManager.check();

        // Monkey-patch track() to always check session
        var originalTrack = mixpanel.track;
        mixpanel.track = function() {
          SessionManager.check();
          mixpanel.register({ 'last event time': Date.now() });
          originalTrack.apply(mixpanel, arguments);
        };

        // Register base properties
        var baseProps = {
          'last event time': Date.now(),
          pp_user_agent: window.navigator.userAgent
        };

        if (CONFIG.projectName) {
          baseProps.project = CONFIG.projectName;
        }

        mixpanel.register(baseProps);

        // Cookie-based identity
        var userId = ppLib.getCookie(CONFIG.cookieNames.userId);
        if (userId) {
          mixpanel.register({ pp_user_id: userId });
        }

        var ipAddress = ppLib.getCookie(CONFIG.cookieNames.ipAddress);
        if (ipAddress) {
          mixpanel.register({ pp_user_ip: ipAddress });
        }

        // Experiment cookie
        var expCookie = ppLib.getCookie(CONFIG.cookieNames.experiments);
        if (expCookie) {
          try {
            var expJson = JSON.parse(expCookie);
            var data = {};
            Object.keys(expJson).forEach(function(item) {
              data[item] = expJson[item];
            });
            mixpanel.people.set_once(data);
            mixpanel.register(data);
          } catch (e) {
            ppLib.log('error', 'Experiment cookie parse error', e);
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
    configure: function(options) {
      if (options) {
        ppLib.extend(CONFIG, options);
      }
      return CONFIG;
    },

    init: function() {
      initMixpanel();
    },

    getMixpanelCookieData: getMixpanelCookieData,

    getConfig: function() {
      return CONFIG;
    }
  };

  ppLib.log('info', '[ppMixpanel] Module loaded');

  } // end initModule

  // Safe load: wait for ppLib if not yet available
  if (window.ppLib && window.ppLib._isReady) {
    initModule(window.ppLib);
  } else {
    window.ppLibReady = window.ppLibReady || [];
    window.ppLibReady.push(initModule);
  }

})(window, document);
