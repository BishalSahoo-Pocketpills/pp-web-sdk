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
      allowlist: ['pocketpills.com', 'pocketpills.info'],
      params: [{ name: 'mp_device_id', source: 'mixpanel_device_id' }],
      decorateOnLoad: true,
      decorateOnClick: true,
      watchMutations: true,
    };

    // =====================================================
    // BUILT-IN SOURCES
    // =====================================================

    function readFromMpInstance(key: string): string {
      const mpRoot = (globalThis as { mixpanel?: MixpanelGlobal }).mixpanel;
      if (!mpRoot) return '';
      // Named instance (loadLibrary: false + initLibrary: true → window.mixpanel.primary)
      const namedMp = (mpRoot as unknown as Record<string, MixpanelGlobal | undefined>)['primary'];
      if (namedMp && typeof namedMp.get_property === 'function') {
        const val = namedMp.get_property(key);
        if (typeof val === 'string' && val) return val;
      }
      // Default or adopted instance
      if (typeof mpRoot.get_property === 'function') {
        const val = mpRoot.get_property(key);
        if (typeof val === 'string' && val) return val;
      }
      return '';
    }

    function getMixpanelDeviceId(): string {
      const cookieVal = ppLib.mixpanel?.getMixpanelCookieData()?.['$device_id'];
      if (typeof cookieVal === 'string' && cookieVal) return cookieVal;
      const liveVal = readFromMpInstance('$device_id');
      if (liveVal) return liveVal;
      ppLib.log('warn', PREFIX + ' mixpanel_device_id: $device_id not available; using empty value');
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
      ppLib.log('warn', PREFIX + ' mixpanel_distinct_id: distinct_id not available; using empty value');
      return '';
    }

    function resolveSource(param: ParamEntry): string {
      const { source } = param;
      if (typeof source === 'function') {
        try {
          const val = source();
          return typeof val === 'string' ? val : '';
        } catch (e) {
          ppLib.log('warn', PREFIX + ' param "' + param.name + '" source threw; using empty value', ppLib.safeLogError(e));
          return '';
        }
      }
      if (source === 'mixpanel_device_id') return getMixpanelDeviceId();
      if (source === 'mixpanel_distinct_id') return getMixpanelDistinctId();
      ppLib.log('warn', PREFIX + ' unknown source "' + source + '" for param "' + param.name + '"; using empty value');
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
        const hostname = url.hostname;
        let changed = false;
        CONFIG.params.forEach(function(param) {
          if (param.enabled === false) return;
          const effectiveAllowlist = param.allowlist ?? CONFIG.allowlist;
          if (!isAllowlisted(hostname, effectiveAllowlist)) return;
          if (url.searchParams.has(param.name)) return;
          url.searchParams.set(param.name, resolveSource(param));
          changed = true;
        });
        if (changed) el.setAttribute('href', url.toString());
      } catch {
        // relative URL — no hostname to check, skip
      }
    }

    function scanAndDecorate(): void {
      try {
        const links = doc.querySelectorAll<HTMLAnchorElement>('a[href]');
        links.forEach(function(link) { decorateLink(link); });
        ppLib.log('verbose', PREFIX + ' Scan complete — ' + links.length + ' link(s) processed');
      } catch (e) {
        ppLib.log('error', PREFIX + ' scanAndDecorate error', ppLib.safeLogError(e));
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

      ppLib.log('info', PREFIX + ' Initialized');
    }

    // =====================================================
    // getConfig() — structural clone that preserves function refs
    // =====================================================

    function cloneConfigForRead(): UrlDecoratorConfig {
      return {
        enabled: CONFIG.enabled,
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

    ppLib.log('info', PREFIX + ' Module loaded');

    /*! v8 ignore start — boot ordering duplicates handled by bootstrapModule */
    if (!ppLib._udBound) {
      ppLib._udBound = true;
      init();
    }
    /*! v8 ignore stop */
  }

  bootstrapModule(win, initModule);
})(window, document);
