import type { BrazeConfig } from '../types/braze.types';

export function createBrazeConfig(): BrazeConfig {
  return {
    sdk: {
      apiKey: '',
      baseUrl: '',
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
      requireEmail: false
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
