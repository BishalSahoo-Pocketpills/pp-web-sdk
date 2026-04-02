import type { PPLib } from '@src/types/common.types';
import type { BrazeConfig } from '@src/types/braze.types';

export function createSdkLoader(
  win: Window & typeof globalThis,
  doc: Document,
  ppLib: PPLib,
  CONFIG: BrazeConfig
) {
  let sdkReady = false;
  const MAX_STUB_QUEUE = 500;
  const stubQueue: Array<{ method: string; args: any[] }> = [];

  // Nested method stubs (e.g. getUser().setEmail())
  const USER_METHODS = [
    'setEmail', 'setFirstName', 'setLastName', 'setPhoneNumber',
    'setGender', 'setDateOfBirth', 'setCountry', 'setHomeCity',
    'setLanguage', 'setCustomUserAttribute'
  ];

  function createStub(): void {
    const stubMethods = [
      'initialize', 'openSession', 'changeUser', 'logCustomEvent',
      'logPurchase', 'requestImmediateDataFlush'
    ];

    const brazeStub: any = {};

    for (let i = 0; i < stubMethods.length; i++) {
      (function(method: string) {
        brazeStub[method] = function() {
          if (stubQueue.length < MAX_STUB_QUEUE) {
            stubQueue.push({ method: method, args: Array.prototype.slice.call(arguments) });
          }
        };
      })(stubMethods[i]);
    }

    // Stub getUser() returning an object with setter stubs
    brazeStub.getUser = function() {
      const userStub: any = {};
      for (let i = 0; i < USER_METHODS.length; i++) {
        (function(method: string) {
          userStub[method] = function() {
            if (stubQueue.length < MAX_STUB_QUEUE) {
              stubQueue.push({ method: 'getUser().' + method, args: Array.prototype.slice.call(arguments) });
            }
          };
        })(USER_METHODS[i]);
      }
      return userStub;
    };

    win.braze = brazeStub;
  }

  function drainQueue(): void {
    const braze = win.braze;
    /*! v8 ignore start */
    if (!braze) return;
    /*! v8 ignore stop */

    for (let i = 0; i < stubQueue.length; i++) {
      var entry = stubQueue[i];
      var method = entry.method;
      var args = entry.args;

      try {
        // Handle nested getUser().method() calls
        /*! v8 ignore start */
        if (method.indexOf('getUser().') === 0) {
        /*! v8 ignore stop */
          var userMethod = method.replace('getUser().', '');
          var user = braze.getUser();
          /*! v8 ignore start */
          if (user && typeof user[userMethod] === 'function') {
          /*! v8 ignore stop */
            user[userMethod].apply(user, args);
          }
        } else if (typeof braze[method] === 'function') {
          braze[method].apply(braze, args);
        }
      } catch (e) {
        ppLib.log('error', '[ppBraze] drainQueue error for ' + method, e);
      }
    }

    stubQueue.length = 0;
  }

  function loadSDK(onReady: () => void): void {
    if (!CONFIG.sdk.cdnUrl) {
      ppLib.log('warn', '[ppBraze] No cdnUrl configured — cannot load Braze SDK');
      return;
    }

    createStub();

    var script = doc.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = CONFIG.sdk.cdnUrl;
    if (CONFIG.sdk.nonce) script.setAttribute('nonce', CONFIG.sdk.nonce);

    script.onload = function() {
      try {
        var braze = win.braze;
        braze.initialize(CONFIG.sdk.apiKey, {
          baseUrl: CONFIG.sdk.baseUrl,
          enableLogging: CONFIG.sdk.enableLogging,
          sessionTimeoutInSeconds: CONFIG.sdk.sessionTimeoutInSeconds
        });
        braze.openSession();

        sdkReady = true;
        drainQueue();
        onReady();

        ppLib.log('info', '[ppBraze] SDK loaded and initialized');
      } catch (e) {
        ppLib.log('error', '[ppBraze] SDK initialization error', e);
      }
    };

    script.onerror = function() {
      ppLib.log('error', '[ppBraze] Failed to load SDK from ' + CONFIG.sdk.cdnUrl + ' (ad blocker?)');
    };

    var first = doc.getElementsByTagName('script')[0];
    /*! v8 ignore start */
    if (first && first.parentNode) {
      first.parentNode.insertBefore(script, first);
    } else {
      doc.head.appendChild(script);
    }
    /*! v8 ignore stop */
  }

  function isReady(): boolean {
    return sdkReady;
  }

  function getStubQueue(): Array<{ method: string; args: any[] }> {
    return stubQueue;
  }

  return {
    createStub: createStub,
    loadSDK: loadSDK,
    drainQueue: drainQueue,
    isReady: isReady,
    getStubQueue: getStubQueue
  };
}
