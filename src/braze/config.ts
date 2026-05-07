import type { BrazeConfig } from '@src/types/braze.types';

export function createBrazeConfig(): BrazeConfig {
  return {
    sdk: {
      apiKey: '',
      baseUrl: '',
      // Default Braze Web SDK CDN URL. Pinned to the 5.6 minor range —
      // Braze publishes new majors against new paths (e.g. `/web-sdk/5.7/`),
      // so this won't auto-upgrade across breaking changes. Override at
      // configure() time for SRI-pinned deployments (replace `5.6` with
      // a fully-qualified version like `5.6.0` and pair with
      // `BrazeSdkConfig.integrity`). Runbook: docs/security/sri-rotation.md.
      cdnUrl: 'https://js.appboycdn.com/web-sdk/5.6/braze.core.min.js',
      enableLogging: false,
      sessionTimeoutInSeconds: 1800
    },
    consent: {
      required: false,
      mode: 'analytics',
      checkFunction: function() { return true; }
    },
    identity: {
      autoIdentify: true,
      userIdCookie: 'userId',
      emailCookie: ''
    },
    form: {
      formAttribute: 'data-braze-form',
      fieldAttribute: 'data-braze-attr',
      formEventAttribute: 'data-braze-form-event',
      preventDefault: false,
      debounceMs: 500,
      flushOnSubmit: true,
      requireEmail: false,
      identifyByEmail: true
    },
    event: {
      eventAttribute: 'data-braze-event',
      propPrefix: 'data-braze-prop-',
      debounceMs: 300,
      includePageContext: true
    },
    purchase: {
      bridgeEcommerce: false,
      defaultCurrency: 'CAD'
    },
    attributeMap: {}
  };
}
