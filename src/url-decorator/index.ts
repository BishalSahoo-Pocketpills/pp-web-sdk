/**
 * pp-analytics-lib: URL Decorator Module
 * Appends identity query parameters to outbound <a> links, enabling cross-domain
 * identity stitching. Supports multiple params, each with its own source and
 * optional allowlist override. Params with no allowlist fall back to the global one.
 *
 * Requires: common.js (window.ppLib), mixpanel.js (for built-in sources)
 * Exposes: window.ppLib.urlDecorator
 */
import type { PPLib } from '@src/types/common.types';
import type { UrlDecoratorConfig, ParamEntry } from '@src/types/url-decorator.types';
import type { DeepPartial } from '@src/types/utility.types';
import type { MixpanelGlobal } from '@src/types/window';
import { bootstrapModule } from '@src/common/bootstrap';

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  function initModule(ppLib: PPLib) {
    const PREFIX = '[ppUrlDecorator]';

    const CONFIG: UrlDecoratorConfig = {
      enabled: true,
      debug: false,
      allowlist: ['pocketpills.com', 'pocketpills.info'],
      params: [{ name: 'mp_device_id', source: 'mixpanel:primary:$device_id' }],
      decorateOnLoad: true,
      decorateOnClick: true,
      watchMutations: true,
    };

    // =====================================================
    // LOGGER — all calls are silent unless CONFIG.debug is true
    // =====================================================

    function log(msg: string): void { if (CONFIG.debug) ppLib.log('info', msg); }
    function warn(msg: string, data?: unknown): void { if (CONFIG.debug) ppLib.log('warn', msg, data); }
    function error(msg: string, data?: unknown): void { if (CONFIG.debug) ppLib.log('error', msg, data); }
    function debug(msg: string): void { if (CONFIG.debug) ppLib.log('verbose', msg); }

    // =====================================================
    // BUILT-IN SOURCES
    // =====================================================

    // @deprecated — resolves 'mixpanel_device_id' built-in for backward compat.
    // New code should use source: 'mixpanel:primary:$device_id' instead.
    function getMixpanelDeviceId(): string {
      const val = resolveDescriptor('mixpanel:primary:$device_id');
      if (val) return val;
      warn(PREFIX + ' mixpanel_device_id: $device_id not found in primary storage');
      return '';
    }

    function getMixpanelDistinctId(): string {
      // Mixpanel stores the current distinct_id under 'distinct_id' in the cookie
      const cookieVal = ppLib.mixpanel?.getMixpanelCookieData()?.['distinct_id'];
      if (typeof cookieVal === 'string' && cookieVal) return cookieVal;
      // Fall back to live instance — get_distinct_id() returns the current identity
      const mpRoot = (globalThis as { mixpanel?: MixpanelGlobal }).mixpanel;
      if (mpRoot) {
        const namedMp = (mpRoot as unknown as Record<string, MixpanelGlobal | undefined>)['primary'];
        if (namedMp && typeof namedMp.get_distinct_id === 'function') {
          const val = namedMp.get_distinct_id();
          if (typeof val === 'string' && val) return val;
        }
        if (typeof mpRoot.get_distinct_id === 'function') {
          const val = mpRoot.get_distinct_id();
          if (typeof val === 'string' && val) return val;
        }
      }
      warn(PREFIX + ' mixpanel_distinct_id: distinct_id not available; using empty value');
      return '';
    }

    // =====================================================
    // DESCRIPTOR SOURCE RESOLVER
    // =====================================================

    // Extracts a string field from a JSON-parsed object. Returns '' if the
    // field is absent or non-string — consistent with other empty-value paths.
    function extractJsonField(raw: string, field: string): string {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const val = (parsed as Record<string, unknown>)[field];
          return typeof val === 'string' ? val : '';
        }
      } catch (_e) { /* malformed JSON — fall through */ }
      return '';
    }

    // Resolves a descriptor source string. Format: storage_type:key[:json_field]
    // Supported types: query_params | cookies | localstorage | mixpanel
    // Returns '' when the value is absent or the descriptor is malformed.
    function resolveDescriptor(source: string): string {
      const firstColon = source.indexOf(':');
      if (firstColon === -1) return '';
      const storageType = source.slice(0, firstColon);
      const rest = source.slice(firstColon + 1);

      if (storageType === 'query_params') {
        try {
          return new URLSearchParams(win.location.search || '').get(rest) ?? '';
        } catch (_e) { return ''; }
      }

      if (storageType === 'mixpanel') {
        // Format: mixpanel:{primary|secondary}:{field}
        const secondColon = rest.indexOf(':');
        if (secondColon === -1) return '';
        const instanceName = rest.slice(0, secondColon);
        const field = rest.slice(secondColon + 1);
        if (!field || (instanceName !== 'primary' && instanceName !== 'secondary')) return '';
        const instance = ppLib.mixpanel?.[instanceName];
        if (!instance) return '';
        // Primary uses cookie persistence — getCookieData() reads mp_<token>_mixpanel.
        // Secondary uses localStorage — cookie read returns {}; fall back to localStorage.
        const cookieVal = instance.getCookieData()?.[field];
        if (typeof cookieVal === 'string' && cookieVal) return cookieVal;
        const token = instance.getConfig().token;
        if (!token) return '';
        try {
          const raw = win.localStorage.getItem('mp_' + token + '_mixpanel');
          if (!raw) return '';
          return extractJsonField(raw, field);
        } catch (_e) { return ''; }
      }

      const secondColon = rest.indexOf(':');
      const keyName = secondColon === -1 ? rest : rest.slice(0, secondColon);
      const jsonField = secondColon === -1 ? null : rest.slice(secondColon + 1);

      if (storageType === 'cookies') {
        const raw = ppLib.getCookie(keyName);  // already decodeURIComponent-decoded
        if (!raw) return '';
        return jsonField ? extractJsonField(raw, jsonField) : raw;
      }

      if (storageType === 'localstorage') {
        try {
          const raw = win.localStorage.getItem(keyName);
          if (!raw) return '';
          return jsonField ? extractJsonField(raw, jsonField) : raw;
        } catch (_e) { return ''; }
      }

      return '';
    }

    function resolveSource(param: ParamEntry): string {
      const { source } = param;
      if (typeof source === 'function') {
        try {
          const val = source();
          return typeof val === 'string' ? val : '';
        } catch (e) {
          warn(PREFIX + ' param "' + param.name + '" source threw; using empty value', ppLib.safeLogError(e));
          return '';
        }
      }
      // Deprecated built-ins — kept for backward compatibility
      if (source === 'mixpanel_device_id') return getMixpanelDeviceId();
      if (source === 'mixpanel_distinct_id') return getMixpanelDistinctId();
      if (
        source.startsWith('query_params:') ||
        source.startsWith('cookies:') ||
        source.startsWith('localstorage:') ||
        source.startsWith('mixpanel:')
      ) return resolveDescriptor(source);
      warn(PREFIX + ' unknown source "' + source + '" for param "' + param.name + '"; using empty value');
      return '';
    }

    // =====================================================
    // URL HELPERS
    // =====================================================

    function isSkippableScheme(href: string): boolean {
      const lower = href.toLowerCase().replace(/^\s+/, '');
      return lower.startsWith('#') ||
        lower.startsWith('javascript:') ||
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('data:');
    }

    function isAllowlisted(hostname: string, allowlist: string[]): boolean {
      const h = hostname.toLowerCase();
      return allowlist.some(function(domain) {
        const d = domain.toLowerCase();
        return h === d || h.endsWith('.' + d);
      });
    }

    // =====================================================
    // DECORATION
    // =====================================================

    function decorateLink(el: HTMLAnchorElement): void {
      const href = el.getAttribute('href');
      if (!href || isSkippableScheme(href)) return;
      try {
        const url = new URL(href);
        // Only decorate secure web links — skip tel:, sms:, http:, mailto:, etc.
        if (url.protocol !== 'https:') return;
        const hostname = url.hostname;
        let changed = false;
        CONFIG.params.forEach(function(param) {
          if (param.enabled === false) return;
          const effectiveAllowlist = param.allowlist ?? CONFIG.allowlist;
          if (!isAllowlisted(hostname, effectiveAllowlist)) return;
          if (url.searchParams.has(param.name)) return;
          const val = resolveSource(param);
          if (!val) return;
          url.searchParams.set(param.name, val);
          changed = true;
        });
        if (changed) el.setAttribute('href', url.toString());
      } catch {
        // relative URL or unparseable href — skip
      }
    }

    function scanAndDecorate(): void {
      try {
        const links = doc.querySelectorAll<HTMLAnchorElement>('a[href]');
        links.forEach(function(link) { decorateLink(link); });
        debug(PREFIX + ' Scan complete — ' + links.length + ' link(s) processed');
      } catch (e) {
        error(PREFIX + ' scanAndDecorate error', ppLib.safeLogError(e));
      }
    }

    // =====================================================
    // EVENT HANDLERS
    // =====================================================

    function handleClick(e: Event): void {
      if (!CONFIG.enabled || !CONFIG.decorateOnClick) return;
      const target = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!target) return;
      decorateLink(target);
    }

    function startMutationObserver(): void {
      if (!CONFIG.watchMutations) return;
      if (!win.MutationObserver) return;
      const activePpLib = ppLib;
      const observer = new win.MutationObserver(function(mutations) {
        if ((win as { ppLib?: unknown }).ppLib !== activePpLib) {
          observer.disconnect();
          return;
        }
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const el = node as Element;
            if (el.tagName === 'A') {
              decorateLink(el as HTMLAnchorElement);
            }
            el.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(function(link) {
              decorateLink(link);
            });
          });
        });
      });
      observer.observe(doc.body, { childList: true, subtree: true });
    }

    // =====================================================
    // INITIALIZATION
    // =====================================================

    function init(): void {
      if (!CONFIG.enabled) return;

      if (CONFIG.decorateOnClick) {
        doc.removeEventListener('click', handleClick, true);
        doc.addEventListener('click', handleClick, true);
      }

      ppLib.mixpanelReady.then(function() {
        if (CONFIG.decorateOnLoad) {
          scanAndDecorate();
        }
        startMutationObserver();
      });

      log(PREFIX + ' Initialized');
    }

    // =====================================================
    // getConfig() — structural clone that preserves function refs
    // =====================================================

    function cloneConfigForRead(): UrlDecoratorConfig {
      return {
        enabled: CONFIG.enabled,
        debug: CONFIG.debug,
        allowlist: [...CONFIG.allowlist],
        decorateOnLoad: CONFIG.decorateOnLoad,
        decorateOnClick: CONFIG.decorateOnClick,
        watchMutations: CONFIG.watchMutations,
        params: CONFIG.params.map(function(p) {
          const clone: ParamEntry = { name: p.name, source: p.source };
          if (p.allowlist !== undefined) clone.allowlist = [...p.allowlist];
          if (p.enabled !== undefined) clone.enabled = p.enabled;
          return clone;
        }),
      };
    }

    // =====================================================
    // PUBLIC API
    // =====================================================

    ppLib.urlDecorator = {
      configure: function(options?: DeepPartial<UrlDecoratorConfig>) {
        if (options) ppLib.extend(CONFIG, options);
        return CONFIG;
      },
      init: init,
      decorate: scanAndDecorate,
      getConfig: cloneConfigForRead,
    };

    // Apply any config pre-seeded via window.ppLibConfig.urlDecorator before
    // the first init() call so the on-load scan uses the caller-provided names.
    const ppLibConfig = (win as { ppLibConfig?: { urlDecorator?: DeepPartial<UrlDecoratorConfig> } }).ppLibConfig;
    if (ppLibConfig?.urlDecorator) ppLib.extend(CONFIG, ppLibConfig.urlDecorator);

    log(PREFIX + ' Module loaded');

    /*! v8 ignore start — boot ordering duplicates handled by bootstrapModule */
    if (!ppLib._udBound) {
      ppLib._udBound = true;
      init();
    }
    /*! v8 ignore stop */
  }

  bootstrapModule(win, initModule);
})(window, document);
