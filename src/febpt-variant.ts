/**
 * Conditional page variant for `source=febpt` traffic.
 *
 * Modifies the payment-page UI when the URL contains the trigger query
 * parameter. CSS injection hides nodes instantly; a MutationObserver
 * waits for Angular to render before rewriting text on the heading,
 * description, and "Pay Now" button.
 *
 * Embed via `<script>` on the payment page; no other SDK dependencies.
 * Selectors and copy are overridable via `window.__ppFebptVariant` set
 * BEFORE the script loads — this lets marketing change copy without a
 * code change, and lets us track Webflow CMS class renames in one place.
 *
 *     <script>
 *       window.__ppFebptVariant = {
 *         triggerQuery: 'source=febpt-may',
 *         textChanges: [{ selector: '.h1', text: 'Welcome' }]
 *       };
 *     </script>
 *     <script src="/.../febpt-variant.js"></script>
 *
 * Test hook: set `window.__ppFebptVariant.disableAutoRun = true` to
 * suppress the auto-invoke, then call `window.__ppFebptVariant.run()`
 * explicitly with mocked DOM.
 */

interface FebptTextChange {
  selector: string;
  text: string;
}

interface FebptButtonChange {
  from: string;
  to: string;
}

interface FebptVariantConfig {
  triggerQuery: string;
  hideSelectors: string[];
  textChanges: FebptTextChange[];
  buttonChanges: FebptButtonChange[];
  buttonScopeSelector: string;
  observerTimeoutMs: number;
  styleTagId: string;
  diagnosticLogPrefix: string;
}

interface FebptVariantGlobal extends Partial<FebptVariantConfig> {
  disableAutoRun?: boolean;
  run?: (overrides?: Partial<FebptVariantConfig>) => void;
}

const DEFAULT_CONFIG: FebptVariantConfig = {
  triggerQuery: 'source=febpt',
  hideSelectors: [
    '.ds-bg-primary-200.questionnaire-container-wrapper',
    '.ds-mb-sm'
  ],
  textChanges: [
    { selector: '.lineheight-xsmall', text: "You're all set to begin your free treatment plan" },
    { selector: 'span.ds-text-primary-800.ds-body-m', text: 'Add your payment details now so your prescription can be delivered to your home on time. Your information is encrypted and secure.' }
  ],
  buttonChanges: [
    { from: 'Pay Now', to: 'Add your card' }
  ],
  buttonScopeSelector: 'button, a, [role="button"]',
  observerTimeoutMs: 15000,
  styleTagId: 'febpt-variant-style',
  diagnosticLogPrefix: '[febpt-variant]'
};

(function(win: Window & typeof globalThis, doc: Document) {
  'use strict';

  const globalSlot: FebptVariantGlobal =
    (win as unknown as { __ppFebptVariant?: FebptVariantGlobal }).__ppFebptVariant || {};

  function run(overrides?: Partial<FebptVariantConfig>): void {
    const config: FebptVariantConfig = {
      ...DEFAULT_CONFIG,
      ...globalSlot,
      ...(overrides || {})
    };

    if (win.location.search.indexOf(config.triggerQuery) === -1) return;

    injectHideStyles(doc, config);

    let applied = false;

    function tryApply(): boolean {
      const missing = config.textChanges.filter(c => doc.querySelector(c.selector) === null);
      if (missing.length > 0) return false;

      config.textChanges.forEach(change => {
        const el = doc.querySelector(change.selector);
        if (el) el.textContent = change.text;
      });

      config.buttonChanges.forEach(change => {
        doc.querySelectorAll(config.buttonScopeSelector).forEach(btn => {
          if (btn.textContent && btn.textContent.trim() === change.from) {
            btn.textContent = change.to;
          }
        });
      });

      applied = true;
      return true;
    }

    if (tryApply()) return;

    const observer = new MutationObserver(() => {
      if (tryApply()) observer.disconnect();
    });

    observer.observe(doc.documentElement, { childList: true, subtree: true });

    win.setTimeout(() => {
      observer.disconnect();
      if (!applied) {
        // Last try, then surface which selectors never matched so this
        // doesn't fail silently when Webflow renames a class.
        if (!tryApply()) {
          const unmatched = config.textChanges
            .filter(c => doc.querySelector(c.selector) === null)
            .map(c => c.selector);
          if (unmatched.length && win.console && typeof win.console.warn === 'function') {
            win.console.warn(
              config.diagnosticLogPrefix + ' selectors did not match within ' +
              config.observerTimeoutMs + 'ms — Webflow CMS class may have changed:',
              unmatched
            );
          }
        }
      }
    }, config.observerTimeoutMs);
  }

  function injectHideStyles(doc: Document, config: FebptVariantConfig): void {
    if (doc.getElementById(config.styleTagId)) return;
    const styleEl = doc.createElement('style');
    styleEl.id = config.styleTagId;
    styleEl.setAttribute('data-variant', 'febpt');
    styleEl.textContent = config.hideSelectors
      .map(sel => sel + ' { display: none !important; }')
      .join(' ');
    doc.head.appendChild(styleEl);
  }

  globalSlot.run = run;
  (win as unknown as { __ppFebptVariant: FebptVariantGlobal }).__ppFebptVariant = globalSlot;

  if (!globalSlot.disableAutoRun) run();

})(window, document);
