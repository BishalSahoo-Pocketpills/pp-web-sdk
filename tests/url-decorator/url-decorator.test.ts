import { loadModule, loadWithCommon, flushMixpanelReady } from '@tests/helpers/iife-loader.ts';
import { createMockMixpanel } from '@tests/helpers/mock-mixpanel.ts';

// Minimal ppLib.mixpanel mock — only the surface the module reads.
// primary.getCookieData() + getConfig() cover the mixpanel:primary:* descriptor path.
// getMixpanelCookieData() is kept for the deprecated getMixpanelDistinctId path.
type MinimalInstanceMock = {
  getCookieData: () => Record<string, unknown>;
  getConfig: () => { token: string };
};
type MinimalMixpanelMock = {
  primary: MinimalInstanceMock;
  getMixpanelCookieData: () => Record<string, unknown>;
};

function setupMixpanelCookie(data: Record<string, unknown>, token = 'test-primary-token') {
  (window.ppLib as Record<string, unknown>).mixpanel = {
    primary: { getCookieData: () => data, getConfig: () => ({ token }) },
    getMixpanelCookieData: () => data,
  } satisfies MinimalMixpanelMock;
}

describe('url-decorator module', () => {

  beforeEach(() => {
    delete (window as Record<string, unknown>).ppLibConfig;
  });

  // -------------------------------------------------------------------------
  // 1. IIFE bootstrap
  // -------------------------------------------------------------------------

  describe('IIFE bootstrap', () => {

    it('initializes when ppLib is already ready', () => {
      loadWithCommon('url-decorator');
      const ud = window.ppLib.urlDecorator!;
      expect(ud).toBeDefined();
      expect(typeof ud.configure).toBe('function');
      expect(typeof ud.init).toBe('function');
      expect(typeof ud.decorate).toBe('function');
      expect(typeof ud.getConfig).toBe('function');
    });

    it('queues initModule to ppLibReady when ppLib is not yet available', () => {
      delete window.ppLib;
      delete window.ppLibReady;
      loadModule('url-decorator');
      expect(Array.isArray(window.ppLibReady)).toBe(true);
      expect(typeof window.ppLibReady![0]).toBe('function');
      loadModule('common');
      expect(window.ppLib.urlDecorator).toBeDefined();
    });

    it('appends to existing ppLibReady queue', () => {
      delete window.ppLib;
      window.ppLibReady = [vi.fn()];
      loadModule('url-decorator');
      expect(window.ppLibReady!.length).toBe(2);
    });

  });

  // -------------------------------------------------------------------------
  // 2. configure() / getConfig()
  // -------------------------------------------------------------------------

  describe('configure / getConfig', () => {

    it('returns default config', () => {
      loadWithCommon('url-decorator');
      const c = window.ppLib.urlDecorator!.getConfig();
      expect(c.enabled).toBe(true);
      expect(c.allowlist).toEqual(['pocketpills.com', 'pocketpills.info']);
      expect(c.params).toHaveLength(1);
      expect(c.params[0].name).toBe('mp_device_id');
      expect(c.params[0].source).toBe('mixpanel:primary:$device_id');
      expect(c.decorateOnLoad).toBe(true);
      expect(c.decorateOnClick).toBe(true);
      expect(c.watchMutations).toBe(true);
    });

    it('merges top-level options without touching params', () => {
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({ decorateOnLoad: false, allowlist: ['example.com'] });
      const c = window.ppLib.urlDecorator!.getConfig();
      expect(c.decorateOnLoad).toBe(false);
      expect(c.allowlist).toEqual(['example.com']);
      expect(c.params[0].name).toBe('mp_device_id'); // untouched
    });

    it('replaces params array when configure() sets params', () => {
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [
          { name: 'p1', source: 'mixpanel_device_id' },
          { name: 'p2', source: 'mixpanel_distinct_id' },
        ],
      });
      const c = window.ppLib.urlDecorator!.getConfig();
      expect(c.params).toHaveLength(2);
      expect(c.params[0].name).toBe('p1');
      expect(c.params[1].name).toBe('p2');
    });

    it('configure() with no args is a no-op', () => {
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure();
      expect(window.ppLib.urlDecorator!.getConfig().allowlist).toEqual(['pocketpills.com', 'pocketpills.info']);
    });

    it('getConfig() returns a structural clone — mutation does not affect live config', () => {
      loadWithCommon('url-decorator');
      const c = window.ppLib.urlDecorator!.getConfig();
      c.allowlist.push('injected.com');
      c.params.push({ name: 'injected', source: 'mixpanel_device_id' });
      const c2 = window.ppLib.urlDecorator!.getConfig();
      expect(c2.allowlist).toEqual(['pocketpills.com', 'pocketpills.info']);
      expect(c2.params).toHaveLength(1);
    });

    it('getConfig() preserves function source references', () => {
      loadWithCommon('url-decorator');
      const fn = () => 'custom-val';
      window.ppLib.urlDecorator!.configure({ params: [{ name: 'x', source: fn }] });
      const c = window.ppLib.urlDecorator!.getConfig();
      expect(c.params[0].source).toBe(fn); // same reference, not JSON-dropped
    });

    it('window.ppLibConfig.urlDecorator is applied before the on-load scan runs', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/rx">Link</a>`;
      (window as Record<string, unknown>).ppLibConfig = {
        urlDecorator: { params: [{ name: 'tracking_id', source: 'mixpanel_device_id' }] },
      };
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      const href = document.querySelector('a')!.getAttribute('href')!;
      expect(href).toContain('tracking_id=dev-abc');
      expect(href).not.toContain('mp_device_id');
    });

  });

  // -------------------------------------------------------------------------
  // 3. On-load scan
  // -------------------------------------------------------------------------

  describe('on-load scan', () => {

    it('decorates allowlisted links after mixpanelReady', async () => {
      document.body.innerHTML = `
        <a href="https://www.pocketpills.com/treatments">Treatments</a>
        <a href="https://app.pocketpills.info/login">Login</a>
      `;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      document.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
        expect(link.getAttribute('href')).toContain('mp_device_id=dev-abc');
      });
    });

    it('does not decorate non-allowlisted external links', async () => {
      document.body.innerHTML = `<a href="https://google.com/search">Google</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://google.com/search');
    });

    it('does not decorate relative URLs', async () => {
      document.body.innerHTML = `<a href="/treatments">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('/treatments');
    });

    it('skips mailto: / tel: / javascript: / data: / # links', async () => {
      document.body.innerHTML = `
        <a href="mailto:a@b.com">M</a>
        <a href="tel:+1234">T</a>
        <a href="javascript:void(0)">J</a>
        <a href="data:text/plain,hi">D</a>
        <a href="#section">H</a>
      `;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      const hrefs = Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href'));
      hrefs.forEach(h => expect(h).not.toContain('mp_device_id'));
    });

    it('is idempotent — does not re-decorate already decorated links', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx?mp_device_id=old">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'new-id' });
      await flushMixpanelReady();

      const url = new URL(document.querySelector('a')!.getAttribute('href')!);
      expect(url.searchParams.get('mp_device_id')).toBe('old');
    });

    it('decorates subdomains of allowlisted domains', async () => {
      document.body.innerHTML = `
        <a href="https://sub.pocketpills.com/page">S1</a>
        <a href="https://deep.sub.pocketpills.info/page">S2</a>
      `;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'sub-dev' });
      await flushMixpanelReady();

      document.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
        expect(link.getAttribute('href')).toContain('mp_device_id=sub-dev');
      });
    });

    it('preserves existing query params when decorating', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx?source=email">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      await flushMixpanelReady();

      const url = new URL(document.querySelector('a')!.getAttribute('href')!);
      expect(url.searchParams.get('source')).toBe('email');
      expect(url.searchParams.get('mp_device_id')).toBe('dev-abc');
    });

    it('skips scan when decorateOnLoad is false', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      window.ppLib.urlDecorator!.configure({ decorateOnLoad: false });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('respects a custom global allowlist', async () => {
      document.body.innerHTML = `
        <a href="https://pocketpills.com/tx">PP</a>
        <a href="https://mycustom.com/page">Custom</a>
      `;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      window.ppLib.urlDecorator!.configure({ allowlist: ['mycustom.com'] });
      await flushMixpanelReady();

      const [pp, custom] = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
      expect(pp.getAttribute('href')).toBe('https://pocketpills.com/tx');
      expect(custom.getAttribute('href')).toContain('mp_device_id=dev-abc');
    });

  });

  // -------------------------------------------------------------------------
  // 4. Multi-param decoration
  // -------------------------------------------------------------------------

  describe('multiple params', () => {

    it('appends all enabled params to a matching URL', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-123', 'distinct_id': 'user-456' });
      window.ppLib.urlDecorator!.configure({
        params: [
          { name: 'mp_device_id',  source: 'mixpanel_device_id'  },
          { name: 'mp_distinct_id', source: 'mixpanel_distinct_id' },
        ],
      });
      await flushMixpanelReady();

      const url = new URL(document.querySelector('a')!.getAttribute('href')!);
      expect(url.searchParams.get('mp_device_id')).toBe('dev-123');
      expect(url.searchParams.get('mp_distinct_id')).toBe('user-456');
    });

    it('each param with its own allowlist decorates only its target domain', async () => {
      document.body.innerHTML = `
        <a href="https://pocketpills.com/tx">PP</a>
        <a href="https://partner.com/page">Partner</a>
      `;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      window.ppLib.urlDecorator!.configure({
        allowlist: [], // global default: nothing (force per-param allowlists)
        params: [
          { name: 'pp_id',      source: 'mixpanel_device_id', allowlist: ['pocketpills.com'] },
          { name: 'partner_id', source: 'mixpanel_device_id', allowlist: ['partner.com']     },
        ],
      });
      await flushMixpanelReady();

      const ppUrl = new URL(document.querySelector<HTMLAnchorElement>('a:nth-child(1)')!.getAttribute('href')!);
      expect(ppUrl.searchParams.get('pp_id')).toBe('dev-abc');
      expect(ppUrl.searchParams.has('partner_id')).toBe(false);

      const partnerUrl = new URL(document.querySelector<HTMLAnchorElement>('a:nth-child(2)')!.getAttribute('href')!);
      expect(partnerUrl.searchParams.get('partner_id')).toBe('dev-abc');
      expect(partnerUrl.searchParams.has('pp_id')).toBe(false);
    });

    it('per-param allowlist takes priority over global allowlist', async () => {
      document.body.innerHTML = `<a href="https://other.com/page">Other</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      window.ppLib.urlDecorator!.configure({
        allowlist: ['pocketpills.com'],           // global: only pp
        params: [
          { name: 'other_id', source: 'mixpanel_device_id', allowlist: ['other.com'] }, // override
        ],
      });
      await flushMixpanelReady();

      const href = document.querySelector('a')!.getAttribute('href')!;
      expect(href).toContain('other_id=dev-abc'); // per-param allowlist honoured
    });

    it('param with enabled: false is skipped even when global is true', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc', 'distinct_id': 'user-xyz' });
      window.ppLib.urlDecorator!.configure({
        params: [
          { name: 'mp_device_id',  source: 'mixpanel_device_id'               },
          { name: 'mp_distinct_id', source: 'mixpanel_distinct_id', enabled: false },
        ],
      });
      await flushMixpanelReady();

      const url = new URL(document.querySelector('a')!.getAttribute('href')!);
      expect(url.searchParams.get('mp_device_id')).toBe('dev-abc');
      expect(url.searchParams.has('mp_distinct_id')).toBe(false);
    });

    it('custom (() => string) source function is called and its value appended', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      const customFn = vi.fn(() => 'custom-val-99');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'custom_id', source: customFn }],
      });
      await flushMixpanelReady();

      expect(customFn).toHaveBeenCalled();
      expect(document.querySelector('a')!.getAttribute('href')).toContain('custom_id=custom-val-99');
    });

    it('custom source that throws skips the param (no empty value appended)', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'bad_id', source: () => { throw new Error('boom'); } }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('empty params array results in no decoration', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc' });
      window.ppLib.urlDecorator!.configure({ params: [] });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

  });

  // -------------------------------------------------------------------------
  // 5. Built-in sources
  // -------------------------------------------------------------------------

  describe('built-in sources', () => {

    it('mixpanel_device_id reads from ppLib.mixpanel cookie data', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'cookie-dev' });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=cookie-dev');
    });

    it('mixpanel_device_id returns empty and skips decoration when primary cookie has no $device_id', async () => {
      // Cookie-only contract: no window.mixpanel fallback. When the primary
      // cookie exists but lacks $device_id, the param is omitted entirely.
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ distinct_id: 'user-123' }); // no $device_id
      window.mixpanel = createMockMixpanel({ initialProperties: { '$device_id': 'should-not-appear' } });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('mixpanel_device_id returns empty when ppLib.mixpanel is not yet configured', async () => {
      // No mixpanel module loaded at all — decorator skips the param rather
      // than reading from window.mixpanel.
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      // Do NOT call setupMixpanelCookie — ppLib.mixpanel remains undefined
      window.mixpanel = createMockMixpanel({ initialProperties: { '$device_id': 'should-not-appear' } });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('mixpanel_device_id cookie source takes priority over window.mixpanel', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'cookie-wins' });
      window.mixpanel = createMockMixpanel({ initialProperties: { '$device_id': 'mp-loses' } });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=cookie-wins');
    });

    it('skips decoration when device_id is unavailable at scan time (no empty param appended)', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('click handler decorates correctly when device_id becomes available after scan (Chrome timing)', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Click me</a>`;
      loadWithCommon('url-decorator');
      // No device_id at scan time — link stays undecorated
      await flushMixpanelReady();
      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');

      // Mixpanel sets device_id later (e.g. after GTM finishes)
      setupMixpanelCookie({ '$device_id': 'late-device-id' });

      // User clicks — click handler fires and decorates with the now-available value
      document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=late-device-id');
    });

    it('mixpanel_distinct_id reads from ppLib.mixpanel cookie (distinct_id key)', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ 'distinct_id': 'user-789' });
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'mp_uid', source: 'mixpanel_distinct_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_uid=user-789');
    });

    it('mixpanel_distinct_id falls back to window.mixpanel.get_distinct_id()', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'mp_uid', source: 'mixpanel_distinct_id' }],
      });
      const mp = createMockMixpanel({ initialProperties: {} });
      (mp as Record<string, unknown>).get_distinct_id = vi.fn(() => 'live-distinct-id');
      window.mixpanel = mp;
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_uid=live-distinct-id');
    });

  });

  // -------------------------------------------------------------------------
  // 6. Descriptor sources (query_params / cookies / localstorage)
  // -------------------------------------------------------------------------

  describe('descriptor sources', () => {

    it('query_params: reads the named param from the current page URL', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      Object.defineProperty(window, 'location', {
        value: { search: '?utm_source=google&utm_medium=cpc', href: 'http://localhost/lp?utm_source=google&utm_medium=cpc' },
        writable: true, configurable: true,
      });
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'utm_source', source: 'query_params:utm_source' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('utm_source=google');
    });

    it('query_params: skips decoration when the param is absent from the URL', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      Object.defineProperty(window, 'location', {
        value: { search: '', href: 'http://localhost/lp' },
        writable: true, configurable: true,
      });
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'utm_source', source: 'query_params:utm_source' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('cookies: reads raw string value from a cookie', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      document.cookie = 'pp_segment=segment_b; path=/';
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'segment', source: 'cookies:pp_segment' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('segment=segment_b');
    });

    it('cookies: reads a JSON field from a cookie', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      document.cookie = 'mp_testtoken_mixpanel=' + encodeURIComponent(JSON.stringify({ '$device_id': 'cookie-uuid', distinct_id: 'user-42' })) + '; path=/';
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'web_device_id', source: 'cookies:mp_testtoken_mixpanel:$device_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('web_device_id=cookie-uuid');
    });

    it('localstorage: reads a JSON field from localStorage', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      localStorage.setItem('mp_sectoken_mixpanel', JSON.stringify({ '$device_id': 'ls-uuid' }));
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'secondary_web_device_id', source: 'localstorage:mp_sectoken_mixpanel:$device_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('secondary_web_device_id=ls-uuid');
    });

    it('localstorage: reads raw string value from localStorage', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      localStorage.setItem('my_flag', 'variant_a');
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'flag', source: 'localstorage:my_flag' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('flag=variant_a');
    });

    it('skips decoration when cookie is absent', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'x', source: 'cookies:nonexistent_cookie' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('skips decoration when localStorage key is absent', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'x', source: 'localstorage:nonexistent_key' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('multiple descriptor params on the same link', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      Object.defineProperty(window, 'location', {
        value: { search: '?utm_source=email', href: 'http://localhost/lp?utm_source=email' },
        writable: true, configurable: true,
      });
      document.cookie = 'mp_tok_mixpanel=' + encodeURIComponent(JSON.stringify({ '$device_id': 'dev-xyz' })) + '; path=/';
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({
        params: [
          { name: 'utm_source', source: 'query_params:utm_source' },
          { name: 'web_device_id', source: 'cookies:mp_tok_mixpanel:$device_id' },
        ],
      });
      await flushMixpanelReady();

      const href = document.querySelector('a')!.getAttribute('href')!;
      expect(href).toContain('utm_source=email');
      expect(href).toContain('web_device_id=dev-xyz');
    });

    it('mixpanel:primary:$device_id reads from primary getCookieData (no hardcoded token)', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      // Primary cookie data — token resolved internally, not hardcoded in source string
      setupMixpanelCookie({ '$device_id': 'primary-cookie-uuid' });
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'web_device_id', source: 'mixpanel:primary:$device_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('web_device_id=primary-cookie-uuid');
    });

    it('mixpanel:primary:distinct_id reads distinct_id from primary cookie', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ distinct_id: 'user-42' });
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'uid', source: 'mixpanel:primary:distinct_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('uid=user-42');
    });

    it('mixpanel:secondary:$device_id falls back to localStorage when cookie is absent', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      const secondaryToken = 'sec-token-xyz';
      localStorage.setItem('mp_' + secondaryToken + '_mixpanel', JSON.stringify({ '$device_id': 'secondary-ls-uuid' }));
      loadWithCommon('url-decorator');
      (window.ppLib as Record<string, unknown>).mixpanel = {
        secondary: {
          getCookieData: () => ({}),  // empty — secondary uses localStorage, not cookies
          getConfig: () => ({ token: secondaryToken }),
        },
        getMixpanelCookieData: () => ({}),
      };
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'secondary_web_device_id', source: 'mixpanel:secondary:$device_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toContain('secondary_web_device_id=secondary-ls-uuid');
    });

    it('mixpanel: returns empty and skips param when ppLib.mixpanel is not configured', async () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      // ppLib.mixpanel not set — module not loaded
      window.ppLib.urlDecorator!.configure({
        params: [{ name: 'web_device_id', source: 'mixpanel:primary:$device_id' }],
      });
      await flushMixpanelReady();

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

  });

  // -------------------------------------------------------------------------
  // 7. Click handler
  // -------------------------------------------------------------------------

  describe('click handler', () => {

    it('decorates an allowlisted link href on click', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'click-dev' });

      document.querySelector('a')!.click();
      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=click-dev');
    });

    it('decorates when click target is a child inside <a>', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx"><span>Go</span></a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'child-dev' });

      document.querySelector('span')!.click();
      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=child-dev');
    });

    it('does not decorate non-allowlisted links on click', () => {
      document.body.innerHTML = `<a href="https://google.com/search">Google</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'click-dev' });

      document.querySelector('a')!.click();
      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://google.com/search');
    });

    it('does not throw when clicking a non-anchor element', () => {
      document.body.innerHTML = `<button>Click</button>`;
      loadWithCommon('url-decorator');
      expect(() => document.querySelector('button')!.click()).not.toThrow();
    });

    it('skips decoration when decorateOnClick is false', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'click-dev' });
      window.ppLib.urlDecorator!.configure({ decorateOnClick: false });

      document.querySelector('a')!.click();
      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('skips decoration when enabled is false', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'click-dev' });
      window.ppLib.urlDecorator!.configure({ enabled: false });

      document.querySelector('a')!.click();
      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://pocketpills.com/tx');
    });

    it('applies all active params on a single click', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'dev-abc', 'distinct_id': 'user-xyz' });
      window.ppLib.urlDecorator!.configure({
        params: [
          { name: 'mp_device_id',  source: 'mixpanel_device_id'  },
          { name: 'mp_distinct_id', source: 'mixpanel_distinct_id' },
        ],
      });

      document.querySelector('a')!.click();
      const url = new URL(document.querySelector('a')!.getAttribute('href')!);
      expect(url.searchParams.get('mp_device_id')).toBe('dev-abc');
      expect(url.searchParams.get('mp_distinct_id')).toBe('user-xyz');
    });

  });

  // -------------------------------------------------------------------------
  // 7. MutationObserver
  // -------------------------------------------------------------------------

  describe('MutationObserver', () => {

    it('decorates <a> tags added dynamically after init', async () => {
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'mut-dev' });
      await flushMixpanelReady();

      const link = document.createElement('a');
      link.setAttribute('href', 'https://pocketpills.com/new-page');
      document.body.appendChild(link);

      await Promise.resolve();
      expect(link.getAttribute('href')).toContain('mp_device_id=mut-dev');
    });

    it('decorates <a> tags inside dynamically added containers', async () => {
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'mut-dev' });
      await flushMixpanelReady();

      const div = document.createElement('div');
      div.innerHTML = '<a href="https://pocketpills.com/page">Link</a>';
      document.body.appendChild(div);

      await Promise.resolve();
      expect(div.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=mut-dev');
    });

    it('does not start observer when watchMutations is false', async () => {
      const observeSpy = vi.spyOn(window.MutationObserver.prototype, 'observe');
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'mut-dev' });
      window.ppLib.urlDecorator!.configure({ watchMutations: false });
      await flushMixpanelReady();

      expect(observeSpy).not.toHaveBeenCalled();
      observeSpy.mockRestore();
    });

    it('does not throw when MutationObserver is unavailable', async () => {
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'mut-dev' });

      const OrigMO = window.MutationObserver;
      (window as Record<string, unknown>).MutationObserver = undefined;
      await expect(flushMixpanelReady()).resolves.not.toThrow();
      window.MutationObserver = OrigMO;
    });

    it('ignores non-element added nodes without throwing', async () => {
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'mut-dev' });
      await flushMixpanelReady();

      expect(() => document.body.appendChild(document.createTextNode('hello'))).not.toThrow();
      await Promise.resolve();
    });

  });

  // -------------------------------------------------------------------------
  // 8. Manual API
  // -------------------------------------------------------------------------

  describe('manual API', () => {

    it('ppLib.urlDecorator.decorate() triggers an immediate scan', () => {
      document.body.innerHTML = `<a href="https://pocketpills.com/tx">Link</a>`;
      loadWithCommon('url-decorator');
      setupMixpanelCookie({ '$device_id': 'manual-dev' });

      window.ppLib.urlDecorator!.decorate();
      expect(document.querySelector('a')!.getAttribute('href')).toContain('mp_device_id=manual-dev');
    });

    it('init() with enabled: false skips handler registration', () => {
      loadWithCommon('url-decorator');
      window.ppLib.urlDecorator!.configure({ enabled: false });
      const addSpy = vi.spyOn(document, 'addEventListener');
      window.ppLib.urlDecorator!.init();

      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });

    it('_udBound prevents double-initialization on repeated module loads', () => {
      loadWithCommon('url-decorator');
      expect(window.ppLib._udBound).toBe(true);

      const addSpy = vi.spyOn(document, 'addEventListener');
      loadModule('url-decorator');
      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });

  });

});
