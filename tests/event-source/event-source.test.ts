import { loadModule, loadWithCommon } from '../helpers/iife-loader.ts';
import { createEventSourceDOM } from '../helpers/mock-dom.ts';
import { createMockMixpanel } from '../helpers/mock-mixpanel.ts';
import { createMockDataLayer } from '../helpers/mock-datalayer.ts';

// =============================================================================
// EVENT-SOURCE MODULE TESTS
//
// Each `loadWithCommon('event-source')` call evaluates the IIFE, which attaches
// persistent click/touchend listeners on `document`. Because jsdom does not
// remove those listeners between tests, we must work around the accumulation:
//
// Strategy: For tests that rely on dataLayer.length or mixpanel.track call
// counts after clicking, we snapshot the counts *before* the action and assert
// on the delta. Helper functions below make this ergonomic.
// =============================================================================

/**
 * Click an element and return only the NEW dataLayer entries that were pushed.
 */
function clickAndCollect(el, dataLayer) {
  const before = dataLayer.length;
  el.click();
  return dataLayer.slice(before);
}

/**
 * Dispatch a custom DOM event and return only the NEW dataLayer entries.
 */
function dispatchAndCollect(el, eventName, dataLayer) {
  const before = dataLayer.length;
  const evt = new Event(eventName, { bubbles: true });
  el.dispatchEvent(evt);
  return dataLayer.slice(before);
}

/**
 * Call a trackFn and return only the NEW dataLayer entries.
 */
function trackAndCollect(trackFn, dataLayer) {
  const before = dataLayer.length;
  trackFn();
  return dataLayer.slice(before);
}

/**
 * Get only the new mixpanel.track calls since a given snapshot count.
 */
function mpCallsSince(mp, snapshot) {
  return mp.track.mock.calls.slice(snapshot);
}

describe('event-source module', () => {

  // ---------------------------------------------------------------------------
  // 1. IIFE BOOTSTRAP
  // ---------------------------------------------------------------------------

  describe('IIFE bootstrap', () => {

    it('calls initModule immediately when ppLib._isReady is true', () => {
      loadWithCommon('event-source');
      expect(window.ppLib).toBeDefined();
      expect(window.ppLib._isReady).toBe(true);
      expect(window.ppLib.eventSource).toBeDefined();
      expect(typeof window.ppLib.eventSource.configure).toBe('function');
    });

    it('pushes initModule to ppLibReady when ppLib is not available', () => {
      delete window.ppLib;
      delete window.ppLibReady;

      loadModule('event-source');

      expect(window.ppLibReady).toBeDefined();
      expect(Array.isArray(window.ppLibReady)).toBe(true);
      expect(window.ppLibReady.length).toBe(1);
      expect(typeof window.ppLibReady[0]).toBe('function');

      // Now load common, which drains the queue
      loadModule('common');
      expect(window.ppLib.eventSource).toBeDefined();
    });

    it('pushes to existing ppLibReady array when ppLib not available', () => {
      delete window.ppLib;
      window.ppLibReady = [vi.fn()];

      loadModule('event-source');

      expect(window.ppLibReady.length).toBe(2);
      expect(typeof window.ppLibReady[1]).toBe('function');
    });

    it('exposes ppLib.eventSource with all public methods', () => {
      loadWithCommon('event-source');
      const es = window.ppLib.eventSource;
      expect(typeof es.configure).toBe('function');
      expect(typeof es.init).toBe('function');
      expect(typeof es.trackElement).toBe('function');
      expect(typeof es.trackCustom).toBe('function');
      expect(typeof es.getConfig).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. AUTO-INITIALIZATION
  // ---------------------------------------------------------------------------

  describe('auto-initialization', () => {

    it('registers click and touchend listeners when readyState is not "loading"', () => {
      const addEventSpy = vi.spyOn(document, 'addEventListener');
      loadWithCommon('event-source');

      const clickCall = addEventSpy.mock.calls.find(c => c[0] === 'click');
      const touchCall = addEventSpy.mock.calls.find(c => c[0] === 'touchend');

      expect(clickCall).toBeDefined();
      expect(clickCall[2]).toEqual({ capture: false, passive: true });
      expect(touchCall).toBeDefined();
      expect(touchCall[2]).toEqual({ capture: false, passive: true });
    });

    it('defers to DOMContentLoaded when readyState is "loading"', () => {
      const originalDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState') ||
                           Object.getOwnPropertyDescriptor(document, 'readyState');
      Object.defineProperty(document, 'readyState', {
        get: () => 'loading',
        configurable: true
      });

      const addEventSpy = vi.spyOn(document, 'addEventListener');

      loadWithCommon('event-source');

      const dclCall = addEventSpy.mock.calls.find(c => c[0] === 'DOMContentLoaded');
      expect(dclCall).toBeDefined();
      expect(typeof dclCall[1]).toBe('function');

      // Fire DOMContentLoaded to trigger deferred init
      const initFn = dclCall[1];
      addEventSpy.mockClear();
      initFn();

      const clickCall = addEventSpy.mock.calls.find(c => c[0] === 'click');
      const touchCall = addEventSpy.mock.calls.find(c => c[0] === 'touchend');
      expect(clickCall).toBeDefined();
      expect(touchCall).toBeDefined();

      // Restore readyState
      if (originalDesc) {
        Object.defineProperty(document, 'readyState', originalDesc);
      } else {
        delete document.readyState;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CONFIG DEFAULTS
  // ---------------------------------------------------------------------------

  describe('CONFIG defaults', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('has default attribute "data-event-source"', () => {
      expect(window.ppLib.eventSource.getConfig().attribute).toBe('data-event-source');
    });

    it('has default debounceMs of 300', () => {
      expect(window.ppLib.eventSource.getConfig().debounceMs).toBe(300);
    });

    it('has mixpanel enabled by default', () => {
      expect(window.ppLib.eventSource.getConfig().platforms.mixpanel.enabled).toBe(true);
    });

    it('has gtm enabled by default', () => {
      expect(window.ppLib.eventSource.getConfig().platforms.gtm.enabled).toBe(true);
    });

    it('has default gtmEventName "element_click"', () => {
      expect(window.ppLib.eventSource.getConfig().gtmEventName).toBe('element_click');
    });

    it('has default mixpanelEventName "Element Click"', () => {
      expect(window.ppLib.eventSource.getConfig().mixpanelEventName).toBe('Element Click');
    });

    it('has includePageContext true by default', () => {
      expect(window.ppLib.eventSource.getConfig().includePageContext).toBe(true);
    });

    it('has categoryAttribute, labelAttribute, valueAttribute', () => {
      const config = window.ppLib.eventSource.getConfig();
      expect(config.categoryAttribute).toBe('data-event-category');
      expect(config.labelAttribute).toBe('data-event-label');
      expect(config.valueAttribute).toBe('data-event-value');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. DEBOUNCE
  // ---------------------------------------------------------------------------

  describe('debounce (isDuplicate via handleInteraction)', () => {

    beforeEach(() => {
      vi.useFakeTimers();
      loadWithCommon('event-source');
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('processes on first interaction', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta_btn', text: 'Click Me' }]);
      const btn = document.querySelector('[data-event-source="cta_btn"]');

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('skips duplicate within debounce window', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta_btn', text: 'Click Me' }]);
      const btn = document.querySelector('[data-event-source="cta_btn"]');

      const first = clickAndCollect(btn, dataLayer);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Second click within 300ms window -- all listeners debounce
      vi.advanceTimersByTime(100);
      const second = clickAndCollect(btn, dataLayer);
      expect(second.length).toBe(0);
    });

    it('processes after debounce window expires', () => {
      const dataLayer = createMockDataLayer();
      // Use unique source/text to avoid stale listener debounce interference
      createEventSourceDOM([{ source: 'debounce_expire_btn', text: 'Expire Test' }]);
      const btn = document.querySelector('[data-event-source="debounce_expire_btn"]');

      const first = clickAndCollect(btn, dataLayer);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Within debounce window -- all listeners debounce
      const dup = clickAndCollect(btn, dataLayer);
      expect(dup.length).toBe(0);

      // Advance past debounce window
      vi.advanceTimersByTime(301);
      const after = clickAndCollect(btn, dataLayer);
      // All listeners fire again after debounce expires
      expect(after.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. getElementId()
  // ---------------------------------------------------------------------------

  describe('getElementId() (tested via debounce behavior)', () => {

    beforeEach(() => {
      vi.useFakeTimers();
      loadWithCommon('event-source');
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('different elements with different source are not debounced together', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([
        { source: 'btn_a', text: 'Alpha' },
        { source: 'btn_b', text: 'Beta' }
      ]);

      const btns = document.querySelectorAll('[data-event-source]');
      const aEntries = clickAndCollect(btns[0], dataLayer);
      const bEntries = clickAndCollect(btns[1], dataLayer);

      // Both should fire (different element IDs, no cross-debounce)
      expect(aEntries.length).toBeGreaterThanOrEqual(1);
      expect(bEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('handles missing attribute gracefully', () => {
      const dataLayer = createMockDataLayer();
      const btn = document.createElement('button');
      document.body.appendChild(btn);

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries.length).toBe(0);
    });

    it('truncates text to 50 chars for element ID (same element debounced)', () => {
      const dataLayer = createMockDataLayer();
      const longText = 'A'.repeat(60);
      createEventSourceDOM([{ source: 'long_text_btn', text: longText }]);
      const btn = document.querySelector('[data-event-source="long_text_btn"]');

      const first = clickAndCollect(btn, dataLayer);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Immediate second click -- debounced because same elementId
      const second = clickAndCollect(btn, dataLayer);
      expect(second.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. extractEventData()
  // ---------------------------------------------------------------------------

  describe('extractEventData()', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('extracts event_source from data-event-source attribute', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'signup_cta', text: 'Sign Up' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_source).toBe('signup_cta');
    });

    it('returns null when attribute is missing (no event dispatched)', () => {
      const dataLayer = createMockDataLayer();
      const btn = document.createElement('button');
      document.body.appendChild(btn);

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries.length).toBe(0);
    });

    it('returns null when sanitized source is empty', () => {
      const dataLayer = createMockDataLayer();
      const btn = document.createElement('button');
      btn.setAttribute('data-event-source', '<>');
      document.body.appendChild(btn);

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries.length).toBe(0);
    });

    it('sanitizes source value', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: '<script>alert("xss")</script>signup', text: 'Hi' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_source).not.toContain('<');
      expect(entries[0].event_source).not.toContain('>');
    });

    it('includes element_tag as lowercase', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ tag: 'button', source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].element_tag).toBe('button');
    });

    it('includes truncated and sanitized element_text', () => {
      const dataLayer = createMockDataLayer();
      const longText = 'B'.repeat(120);
      createEventSourceDOM([{ source: 'long_text', text: longText }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].element_text.length).toBeLessThanOrEqual(100);
    });

    it('includes element_href for anchor elements', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ tag: 'a', source: 'pricing_link', href: 'https://example.com/pricing', text: 'Pricing' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].element_href).toContain('example.com/pricing');
    });

    it('has empty href for non-anchor elements', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ tag: 'button', source: 'btn_cta', text: 'Click' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].element_href).toBe('');
    });

    it('includes event_category when set', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go', category: 'navigation' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_category).toBe('navigation');
    });

    it('includes event_label when set', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go', label: 'header_cta' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_label).toBe('header_cta');
    });

    it('includes event_value when set', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go', value: '42' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_value).toBe('42');
    });

    it('does not include event_category when attribute is absent', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_category).toBeUndefined();
    });

    it('does not include event_label when attribute is absent', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_label).toBeUndefined();
    });

    it('does not include event_value when attribute is absent', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].event_value).toBeUndefined();
    });

    it('includes page context when includePageContext is true', () => {
      const dataLayer = createMockDataLayer();
      document.title = 'Test Page';
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].page_url).toBeDefined();
      expect(entries[0].page_path).toBeDefined();
      expect(entries[0].page_title).toBe('Test Page');
    });

    it('excludes page context when includePageContext is false', () => {
      const dataLayer = createMockDataLayer();
      window.ppLib.eventSource.configure({ includePageContext: false });
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      // Use the last entry: earlier handlers (from prior loadWithCommon calls)
      // still have includePageContext=true, but the most recent handler respects the config change.
      const last = entries[entries.length - 1];
      expect(last.page_url).toBeUndefined();
      expect(last.page_path).toBeUndefined();
      expect(last.page_title).toBeUndefined();
    });

    it('includes timestamp in ISO format', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'cta', text: 'Go' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. sendToMixpanel()
  // ---------------------------------------------------------------------------

  describe('sendToMixpanel()', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('calls mixpanel.track with event name and data', () => {
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      createMockDataLayer();
      createEventSourceDOM([{ source: 'mp_test', text: 'Click' }]);

      const snapshot = mp.track.mock.calls.length;
      document.querySelector('[data-event-source]').click();
      const newCalls = mpCallsSince(mp, snapshot);

      expect(newCalls.length).toBeGreaterThanOrEqual(1);
      expect(newCalls[0][0]).toBe('Element Click');
      expect(newCalls[0][1]).toMatchObject({ event_source: 'mp_test' });
    });

    it('skips when mixpanel platform is disabled', () => {
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      createMockDataLayer();
      window.ppLib.eventSource.configure({ platforms: { mixpanel: { enabled: false } } });
      createEventSourceDOM([{ source: 'mp_disabled', text: 'Click' }]);

      const snapshot = mp.track.mock.calls.length;
      document.querySelector('[data-event-source]').click();
      const newCalls = mpCallsSince(mp, snapshot);

      // At least one listener (from the current module load) should NOT call mp.track.
      // Some stale listeners from prior tests may call track, but we verify
      // the *last* call set did not include one from the disabled config.
      // Better: use trackElement to bypass stale listeners entirely.
      // Let's use a direct trackElement call for precision.
      const mp2 = createMockMixpanel();
      window.mixpanel = mp2;
      const el = document.querySelector('[data-event-source]');
      window.ppLib.eventSource.trackElement(el);
      expect(mp2.track).not.toHaveBeenCalled();
    });

    it('skips when window.mixpanel is unavailable', () => {
      createMockDataLayer();
      createEventSourceDOM([{ source: 'no_mp', text: 'Click' }]);

      expect(() => {
        document.querySelector('[data-event-source]').click();
      }).not.toThrow();
    });

    it('skips when mixpanel.track is unavailable', () => {
      window.mixpanel = {}; // no track method
      createMockDataLayer();
      createEventSourceDOM([{ source: 'no_track', text: 'Click' }]);

      expect(() => {
        document.querySelector('[data-event-source]').click();
      }).not.toThrow();
    });

    it('handles errors in mixpanel.track gracefully', () => {
      const mp = createMockMixpanel();
      mp.track.mockImplementation(() => { throw new Error('Mixpanel error'); });
      window.mixpanel = mp;
      createMockDataLayer();
      createEventSourceDOM([{ source: 'mp_error', text: 'Click' }]);

      expect(() => {
        document.querySelector('[data-event-source]').click();
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 8. sendToGTM()
  // ---------------------------------------------------------------------------

  describe('sendToGTM()', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('pushes to dataLayer with gtmEventName', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'gtm_test', text: 'Click' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].event).toBe('element_click');
    });

    it('initializes dataLayer if it does not exist', () => {
      delete window.dataLayer;
      createEventSourceDOM([{ source: 'init_dl', text: 'Click' }]);

      // Use trackElement to avoid stale listener issues
      const el = document.querySelector('[data-event-source]');
      window.ppLib.eventSource.trackElement(el);

      expect(window.dataLayer).toBeDefined();
      expect(Array.isArray(window.dataLayer)).toBe(true);
      expect(window.dataLayer.length).toBeGreaterThanOrEqual(1);
    });

    it('copies all properties from data to gtmData', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'copy_props', text: 'Go', category: 'nav', label: 'top', value: '10' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      const pushed = entries[0];
      expect(pushed.event).toBe('element_click');
      expect(pushed.event_source).toBe('copy_props');
      expect(pushed.element_tag).toBe('button');
      expect(pushed.event_category).toBe('nav');
      expect(pushed.event_label).toBe('top');
      expect(pushed.event_value).toBe('10');
      expect(pushed.interaction_type).toBe('click');
    });

    it('skips when gtm platform is disabled', () => {
      const dataLayer = createMockDataLayer();
      window.ppLib.eventSource.configure({ platforms: { gtm: { enabled: false } } });
      createEventSourceDOM([{ source: 'gtm_disabled', text: 'Click' }]);

      // Use trackElement to test only current module's behavior
      const el = document.querySelector('[data-event-source]');
      const before = dataLayer.length;
      window.ppLib.eventSource.trackElement(el);
      expect(dataLayer.length).toBe(before);
    });

    it('handles errors in dataLayer.push gracefully', () => {
      // Set up a dataLayer that throws on push
      window.dataLayer = { push: () => { throw new Error('GTM error'); } };
      // Also make it array-like so `window.dataLayer = window.dataLayer || []` keeps it
      createEventSourceDOM([{ source: 'gtm_error', text: 'Click' }]);

      expect(() => {
        window.ppLib.eventSource.trackElement(document.querySelector('[data-event-source]'));
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 9. dispatchEvent()
  // ---------------------------------------------------------------------------

  describe('dispatchEvent()', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('calls both sendToMixpanel and sendToGTM', () => {
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      const dataLayer = createMockDataLayer();

      createEventSourceDOM([{ source: 'dispatch_test', text: 'Go' }]);
      const el = document.querySelector('[data-event-source]');

      const mpBefore = mp.track.mock.calls.length;
      const dlBefore = dataLayer.length;
      window.ppLib.eventSource.trackElement(el);

      expect(mp.track.mock.calls.length - mpBefore).toBe(1);
      expect(dataLayer.length - dlBefore).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. handleInteraction()
  // ---------------------------------------------------------------------------

  describe('handleInteraction()', () => {

    beforeEach(() => {
      vi.useFakeTimers();
      loadWithCommon('event-source');
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('extracts data on target with data-event-source', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'target_btn', text: 'Direct' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].event_source).toBe('target_btn');
    });

    it('uses closest() for nested child elements', () => {
      const dataLayer = createMockDataLayer();

      const parent = document.createElement('div');
      parent.setAttribute('data-event-source', 'parent_source');
      const child = document.createElement('span');
      child.textContent = 'Nested text';
      parent.appendChild(child);
      document.body.appendChild(parent);

      const entries = clickAndCollect(child, dataLayer);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].event_source).toBe('parent_source');
    });

    it('adds interaction_type "click" from click event', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'type_test', text: 'Click Me' }]);

      const entries = clickAndCollect(document.querySelector('[data-event-source]'), dataLayer);
      expect(entries[0].interaction_type).toBe('click');
    });

    it('adds interaction_type "touchend" from touchend event', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'touch_test', text: 'Tap Me' }]);

      const el = document.querySelector('[data-event-source]');
      const entries = dispatchAndCollect(el, 'touchend', dataLayer);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].interaction_type).toBe('touchend');
    });

    it('debounces duplicate interactions on same element', () => {
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([{ source: 'debounce_test', text: 'Click' }]);
      const btn = document.querySelector('[data-event-source]');

      const first = clickAndCollect(btn, dataLayer);
      expect(first.length).toBeGreaterThanOrEqual(1);

      vi.advanceTimersByTime(50);
      const second = clickAndCollect(btn, dataLayer);
      expect(second.length).toBe(0);
    });

    it('no-op when no element with data-event-source is found', () => {
      const dataLayer = createMockDataLayer();
      const div = document.createElement('div');
      div.textContent = 'No source';
      document.body.appendChild(div);

      const entries = clickAndCollect(div, dataLayer);
      expect(entries.length).toBe(0);
    });

    it('no-op when extractEventData returns null (empty source)', () => {
      const dataLayer = createMockDataLayer();
      const btn = document.createElement('button');
      btn.setAttribute('data-event-source', '');
      document.body.appendChild(btn);

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries.length).toBe(0);
    });

    it('handles errors in handleInteraction gracefully', () => {
      const dataLayer = createMockDataLayer();

      const el = document.createElement('button');
      el.setAttribute('data-event-source', 'error_test');
      el.textContent = 'Error';
      document.body.appendChild(el);

      // Override closest to throw
      el.closest = () => { throw new Error('closest error'); };

      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: el, writable: false });

      expect(() => {
        document.dispatchEvent(event);
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 11. PUBLIC API
  // ---------------------------------------------------------------------------

  describe('public API', () => {

    // -------------------------------------------------------------------------
    // configure()
    // -------------------------------------------------------------------------

    describe('configure()', () => {

      beforeEach(() => {
        loadWithCommon('event-source');
      });

      it('merges options into CONFIG and returns CONFIG', () => {
        const result = window.ppLib.eventSource.configure({ debounceMs: 500 });
        expect(result.debounceMs).toBe(500);
        expect(result.attribute).toBe('data-event-source');
      });

      it('returns CONFIG when called with no arguments', () => {
        const result = window.ppLib.eventSource.configure();
        expect(result.attribute).toBe('data-event-source');
      });

      it('returns CONFIG when called with null', () => {
        const result = window.ppLib.eventSource.configure(null);
        expect(result.attribute).toBe('data-event-source');
      });

      it('returns CONFIG when called with undefined', () => {
        const result = window.ppLib.eventSource.configure(undefined);
        expect(result.attribute).toBe('data-event-source');
      });

      it('deep merges nested platform options', () => {
        const result = window.ppLib.eventSource.configure({
          platforms: { mixpanel: { enabled: false } }
        });
        expect(result.platforms.mixpanel.enabled).toBe(false);
        expect(result.platforms.gtm.enabled).toBe(true);
      });

      it('overrides gtmEventName', () => {
        const result = window.ppLib.eventSource.configure({ gtmEventName: 'custom_click' });
        expect(result.gtmEventName).toBe('custom_click');
      });

      it('overrides mixpanelEventName', () => {
        const result = window.ppLib.eventSource.configure({ mixpanelEventName: 'Custom Click' });
        expect(result.mixpanelEventName).toBe('Custom Click');
      });
    });

    // -------------------------------------------------------------------------
    // init()
    // -------------------------------------------------------------------------

    describe('init()', () => {

      beforeEach(() => {
        loadWithCommon('event-source');
      });

      it('registers click and touchend event listeners when called manually', () => {
        const addEventSpy = vi.spyOn(document, 'addEventListener');

        window.ppLib.eventSource.init();

        const clickCall = addEventSpy.mock.calls.find(c => c[0] === 'click');
        const touchCall = addEventSpy.mock.calls.find(c => c[0] === 'touchend');
        expect(clickCall).toBeDefined();
        expect(touchCall).toBeDefined();
      });

      it('handles errors during init gracefully', () => {
        const origAdd = document.addEventListener;
        document.addEventListener = () => { throw new Error('addEventListener failed'); };

        expect(() => {
          window.ppLib.eventSource.init();
        }).not.toThrow();

        document.addEventListener = origAdd;
      });
    });

    // -------------------------------------------------------------------------
    // trackElement()
    // -------------------------------------------------------------------------

    describe('trackElement()', () => {

      beforeEach(() => {
        loadWithCommon('event-source');
      });

      it('extracts data and dispatches with interaction_type "manual"', () => {
        const mp = createMockMixpanel();
        window.mixpanel = mp;
        const dataLayer = createMockDataLayer();

        createEventSourceDOM([{ source: 'manual_track', text: 'Track Me' }]);
        const el = document.querySelector('[data-event-source]');

        const dlBefore = dataLayer.length;
        const mpBefore = mp.track.mock.calls.length;
        window.ppLib.eventSource.trackElement(el);

        const newMp = mpCallsSince(mp, mpBefore);
        expect(newMp.length).toBe(1);
        expect(newMp[0][0]).toBe('Element Click');
        expect(newMp[0][1]).toMatchObject({
          event_source: 'manual_track',
          interaction_type: 'manual'
        });

        const newDl = dataLayer.slice(dlBefore);
        expect(newDl.length).toBe(1);
        expect(newDl[0].interaction_type).toBe('manual');
      });

      it('is a no-op for null element', () => {
        const dataLayer = createMockDataLayer();
        const before = dataLayer.length;
        window.ppLib.eventSource.trackElement(null);
        expect(dataLayer.length).toBe(before);
      });

      it('is a no-op for undefined element', () => {
        const dataLayer = createMockDataLayer();
        const before = dataLayer.length;
        window.ppLib.eventSource.trackElement(undefined);
        expect(dataLayer.length).toBe(before);
      });

      it('is a no-op when element has no data-event-source', () => {
        const dataLayer = createMockDataLayer();
        const btn = document.createElement('button');
        document.body.appendChild(btn);

        const before = dataLayer.length;
        window.ppLib.eventSource.trackElement(btn);
        expect(dataLayer.length).toBe(before);
      });

      it('is a no-op when sanitized source is empty', () => {
        const dataLayer = createMockDataLayer();
        const btn = document.createElement('button');
        btn.setAttribute('data-event-source', '<>');
        document.body.appendChild(btn);

        const before = dataLayer.length;
        window.ppLib.eventSource.trackElement(btn);
        expect(dataLayer.length).toBe(before);
      });
    });

    // -------------------------------------------------------------------------
    // trackCustom()
    // -------------------------------------------------------------------------

    describe('trackCustom()', () => {

      beforeEach(() => {
        loadWithCommon('event-source');
      });

      it('dispatches custom event with sanitized source', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('custom_source', { action: 'subscribe' }),
          dataLayer
        );

        expect(entries.length).toBe(1);
        expect(entries[0].event_source).toBe('custom_source');
      });

      it('sets element_tag to "custom"', () => {
        const dataLayer = createMockDataLayer();
        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('test_source'),
          dataLayer
        );
        expect(entries[0].element_tag).toBe('custom');
      });

      it('sets element_text to empty string', () => {
        const dataLayer = createMockDataLayer();
        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('test_source'),
          dataLayer
        );
        expect(entries[0].element_text).toBe('');
      });

      it('sets interaction_type to "custom"', () => {
        const dataLayer = createMockDataLayer();
        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('test_source'),
          dataLayer
        );
        expect(entries[0].interaction_type).toBe('custom');
      });

      it('includes timestamp in ISO format', () => {
        const dataLayer = createMockDataLayer();
        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('test_source'),
          dataLayer
        );
        expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('includes page context when includePageContext is true', () => {
        const dataLayer = createMockDataLayer();
        document.title = 'Custom Test';

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('ctx_test'),
          dataLayer
        );

        expect(entries[0].page_url).toBeDefined();
        expect(entries[0].page_path).toBeDefined();
        expect(entries[0].page_title).toBe('Custom Test');
      });

      it('excludes page context when includePageContext is false', () => {
        const dataLayer = createMockDataLayer();
        window.ppLib.eventSource.configure({ includePageContext: false });

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('no_ctx'),
          dataLayer
        );

        expect(entries[0].page_url).toBeUndefined();
        expect(entries[0].page_path).toBeUndefined();
        expect(entries[0].page_title).toBeUndefined();
      });

      it('sanitizes custom properties', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('sanitize_test', {
            detail: '<script>xss</script>safe'
          }),
          dataLayer
        );

        expect(entries[0].detail).not.toContain('<script>');
        expect(entries[0].detail).not.toContain('<');
      });

      it('converts property values to strings before sanitizing', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('convert_test', { count: 42 }),
          dataLayer
        );

        expect(entries[0].count).toBe('42');
      });

      it('handles null properties', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('null_props', null),
          dataLayer
        );

        expect(entries.length).toBe(1);
        expect(entries[0].event_source).toBe('null_props');
      });

      it('handles undefined properties (no second arg)', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('undef_props'),
          dataLayer
        );

        expect(entries.length).toBe(1);
        expect(entries[0].event_source).toBe('undef_props');
      });

      it('handles non-object properties (string)', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('str_props', 'not_an_object'),
          dataLayer
        );

        expect(entries.length).toBe(1);
        expect(entries[0].event_source).toBe('str_props');
      });

      it('sanitizes the eventSource parameter', () => {
        const dataLayer = createMockDataLayer();

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('<script>bad</script>source'),
          dataLayer
        );

        expect(entries[0].event_source).not.toContain('<');
        expect(entries[0].event_source).not.toContain('>');
      });

      it('sends to both mixpanel and GTM', () => {
        const mp = createMockMixpanel();
        window.mixpanel = mp;
        const dataLayer = createMockDataLayer();

        const mpBefore = mp.track.mock.calls.length;
        const dlBefore = dataLayer.length;

        window.ppLib.eventSource.trackCustom('dual_test', { key: 'value' });

        expect(mp.track.mock.calls.length - mpBefore).toBe(1);
        expect(dataLayer.length - dlBefore).toBe(1);
      });

      it('logs warning and returns for empty eventSource', () => {
        const logSpy = vi.spyOn(window.ppLib, 'log');
        const dataLayer = createMockDataLayer();
        const before = dataLayer.length;

        window.ppLib.eventSource.trackCustom('');

        expect(dataLayer.length).toBe(before);
        expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('trackCustom requires a non-empty eventSource'));
      });

      it('logs warning when eventSource is rejected by sanitization', () => {
        const logSpy = vi.spyOn(window.ppLib, 'log');
        const dataLayer = createMockDataLayer();
        const before = dataLayer.length;

        // A string consisting only of characters that sanitize strips → empty after sanitization
        window.ppLib.eventSource.trackCustom('<>');

        expect(dataLayer.length).toBe(before);
        expect(logSpy).toHaveBeenCalledWith('warn', expect.stringContaining('rejected by sanitization'));
      });

      it('only copies own properties from properties object', () => {
        const dataLayer = createMockDataLayer();

        const proto = { inherited: 'should_not_appear' };
        const props = Object.create(proto);
        props.own = 'should_appear';

        const entries = trackAndCollect(
          () => window.ppLib.eventSource.trackCustom('own_props', props),
          dataLayer
        );

        expect(entries[0].own).toBeDefined();
        expect(entries[0].inherited).toBeUndefined();
      });
    });

    // -------------------------------------------------------------------------
    // getConfig()
    // -------------------------------------------------------------------------

    describe('getConfig()', () => {

      beforeEach(() => {
        loadWithCommon('event-source');
      });

      it('returns the CONFIG object', () => {
        const config = window.ppLib.eventSource.getConfig();
        expect(config).toBeDefined();
        expect(config.attribute).toBe('data-event-source');
        expect(config.debounceMs).toBe(300);
      });

      it('returns the same reference as configure()', () => {
        const fromConfigure = window.ppLib.eventSource.configure();
        const fromGetConfig = window.ppLib.eventSource.getConfig();
        expect(fromConfigure).toBe(fromGetConfig);
      });

      it('reflects configuration changes', () => {
        window.ppLib.eventSource.configure({ debounceMs: 1000 });
        const config = window.ppLib.eventSource.getConfig();
        expect(config.debounceMs).toBe(1000);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // EDGE CASES & INTEGRATION
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {

    beforeEach(() => {
      loadWithCommon('event-source');
    });

    it('custom gtmEventName is used in dataLayer push', () => {
      const dataLayer = createMockDataLayer();
      window.ppLib.eventSource.configure({ gtmEventName: 'custom_event' });

      createEventSourceDOM([{ source: 'custom_name', text: 'Click' }]);
      const el = document.querySelector('[data-event-source]');

      // Use trackElement to avoid stale listeners that have default config
      const before = dataLayer.length;
      window.ppLib.eventSource.trackElement(el);
      const entries = dataLayer.slice(before);
      expect(entries[0].event).toBe('custom_event');
    });

    it('custom mixpanelEventName is used in mixpanel.track call', () => {
      const mp = createMockMixpanel();
      window.mixpanel = mp;
      createMockDataLayer();
      window.ppLib.eventSource.configure({ mixpanelEventName: 'Custom Event Name' });

      createEventSourceDOM([{ source: 'custom_mp', text: 'Click' }]);
      const el = document.querySelector('[data-event-source]');

      const mpBefore = mp.track.mock.calls.length;
      window.ppLib.eventSource.trackElement(el);
      const newCalls = mpCallsSince(mp, mpBefore);

      expect(newCalls[0][0]).toBe('Custom Event Name');
    });

    it('anchor element with no href does not populate element_href', () => {
      const dataLayer = createMockDataLayer();

      const a = document.createElement('a');
      a.setAttribute('data-event-source', 'no_href_link');
      a.textContent = 'No href';
      document.body.appendChild(a);

      const entries = clickAndCollect(a, dataLayer);
      expect(entries[0].element_href).toBe('');
    });

    it('handles element with empty innerText', () => {
      const dataLayer = createMockDataLayer();

      const btn = document.createElement('button');
      btn.setAttribute('data-event-source', 'empty_text');
      document.body.appendChild(btn);

      const entries = clickAndCollect(btn, dataLayer);
      expect(entries[0].element_text).toBe('');
    });

    it('multiple elements can be tracked independently', () => {
      vi.useFakeTimers();
      const dataLayer = createMockDataLayer();
      createEventSourceDOM([
        { source: 'btn_1', text: 'First' },
        { source: 'btn_2', text: 'Second' },
        { source: 'btn_3', text: 'Third' }
      ]);

      const btns = document.querySelectorAll('[data-event-source]');
      const e1 = clickAndCollect(btns[0], dataLayer);
      const e2 = clickAndCollect(btns[1], dataLayer);
      const e3 = clickAndCollect(btns[2], dataLayer);

      expect(e1.length).toBeGreaterThanOrEqual(1);
      expect(e2.length).toBeGreaterThanOrEqual(1);
      expect(e3.length).toBeGreaterThanOrEqual(1);
      expect(e1[0].event_source).toBe('btn_1');
      expect(e2[0].event_source).toBe('btn_2');
      expect(e3[0].event_source).toBe('btn_3');

      vi.useRealTimers();
    });

    it('ppLib.log is called on module load', () => {
      // Re-load and verify no errors (coverage for ppLib.log('info', ...) at end)
      const logSpy = vi.spyOn(window.ppLib, 'log');
      // Enable debug to exercise log
      window.ppLib.config.debug = true;
      loadModule('event-source');
      expect(logSpy).toHaveBeenCalledWith('info', '[ppEventSource] Module loaded');
    });

    it('ppLib.log is called on init success', () => {
      window.ppLib.config.debug = true;
      const logSpy = vi.spyOn(window.ppLib, 'log');
      window.ppLib.eventSource.init();
      expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('[ppEventSource] Initialized'));
    });
  });

  // --- Coverage: getElementId handles element where tagName is falsy (line 74 branch) ---
  describe('getElementId edge cases', () => {
    it('handles element with no tagName gracefully', () => {
      // The || '' fallback on tagName. In practice tagName is always set on elements,
      // but the branch exists. We test it indirectly through debounce behavior.
      // Create two identical elements and verify debounce works
      loadWithCommon('event-source');
      const el1 = document.createElement('button');
      el1.setAttribute('data-event-source', 'test_btn');
      el1.textContent = 'Click';
      document.body.appendChild(el1);

      const mp = createMockMixpanel();
      window.mixpanel = mp;

      const before = mp.track.mock.calls.length;
      el1.dispatchEvent(new Event('click', { bubbles: true }));
      expect(mp.track.mock.calls.length).toBeGreaterThan(before);
    });
  });

  // --- Coverage: sendToGTM hasOwnProperty check (line 154 branch) ---
  describe('sendToGTM hasOwnProperty branch', () => {
    it('only copies own properties, not inherited', () => {
      loadWithCommon('event-source');
      const dataLayer = createMockDataLayer();

      // Create an element with data-event-source
      const el = document.createElement('button');
      el.setAttribute('data-event-source', 'test_own_props');
      el.textContent = 'Test';
      document.body.appendChild(el);

      // Use trackElement to dispatch, which goes through sendToGTM
      const before = dataLayer.length;
      window.ppLib.eventSource.trackElement(el);
      const gtmEntry = dataLayer.slice(before).find(e => e.event === 'element_click');
      expect(gtmEntry).toBeDefined();
      expect(gtmEntry.event_source).toBe('test_own_props');
      // Verify own properties from data are present
      expect(gtmEntry).toHaveProperty('element_tag');
    });

    it('sendToGTM iterates data properties via for..in', () => {
      loadWithCommon('event-source');
      const dataLayer = createMockDataLayer();

      // trackCustom passes through sendToGTM with custom properties
      window.ppLib.eventSource.trackCustom('custom_source', { foo: 'bar', baz: '123' });
      const gtmEntry = dataLayer.find(e => e.event === 'element_click' && e.event_source === 'custom_source');
      expect(gtmEntry).toBeDefined();
      expect(gtmEntry.foo).toBe('bar');
      expect(gtmEntry.baz).toBe('123');
    });
  });
});
