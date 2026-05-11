/**
 * Conditional page variant for source=febpt traffic.
 *
 * Modifies the payment page UI when the URL contains source=febpt.
 * Designed for Angular-rendered pages — uses CSS injection for instant
 * hide/show and MutationObserver for text changes.
 *
 * Embed via <script> tag on the payment page. No dependencies.
 */
(function(win, doc) {
  'use strict';

  // Only apply when source=febpt is in the URL
  if (win.location.search.indexOf('source=febpt') === -1) return;

  // --- Phase 1: CSS injection (instant, no Angular timing dependency) ---
  const css =
    /* Hide yellow refund banner */
    '.ds-bg-primary-200.questionnaire-container-wrapper { display: none !important; }' +
    /* Hide "Powered by Moneris" */
    '.ds-mb-sm { display: none !important; }';

  const styleEl = doc.createElement('style');
  styleEl.setAttribute('data-variant', 'febpt');
  styleEl.textContent = css;
  doc.head.appendChild(styleEl);

  // --- Phase 2: Text changes (waits for Angular to render) ---
  const TEXT_CHANGES = [
    {
      // Heading
      selector: '.lineheight-xsmall',
      text: "You're all set to begin your free treatment plan"
    },
    {
      // Description paragraph
      selector: 'span.ds-text-primary-800.ds-body-m',
      text: 'Add your payment details now so your prescription can be delivered to your home on time. Your information is encrypted and secure.'
    }
  ];

  const BUTTON_CHANGES = [
    { from: 'Pay Now', to: 'Add your card' }
  ];

  let applied = false;

  function applyTextChanges() {
    // Check if the target elements exist yet
    const ready = TEXT_CHANGES.every(function(change) {
      return doc.querySelector(change.selector) !== null;
    });
    if (!ready) return false;

    // Apply text changes
    TEXT_CHANGES.forEach(function(change) {
      const el = doc.querySelector(change.selector);
      if (el) el.textContent = change.text;
    });

    // Apply button changes
    BUTTON_CHANGES.forEach(function(change) {
      doc.querySelectorAll('button, a, [role="button"]').forEach(function(btn) {
        if (btn.textContent && btn.textContent.trim() === change.from) {
          btn.textContent = change.to;
        }
      });
    });

    applied = true;
    return true;
  }

  // Try immediately (in case Angular already rendered)
  if (applyTextChanges()) return;

  // Otherwise observe DOM until elements appear
  const observer = new MutationObserver(function() {
    if (applyTextChanges()) {
      observer.disconnect();
    }
  });

  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true
  });

  // Safety timeout — disconnect after 15 seconds
  win.setTimeout(function() {
    observer.disconnect();
    if (!applied) {
      // Last attempt
      applyTextChanges();
    }
  }, 15000);

})(window, document);
