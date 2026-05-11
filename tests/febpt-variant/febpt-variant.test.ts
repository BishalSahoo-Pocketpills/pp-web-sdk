import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const variantSrc = readFileSync(
  path.resolve(__dirname, '../../.cache/febpt-variant.js'),
  'utf-8'
);

interface VariantGlobal {
  disableAutoRun?: boolean;
  run?: (overrides?: Record<string, unknown>) => void;
  triggerQuery?: string;
}

function loadVariant(): void {
  new vm.Script(variantSrc).runInThisContext();
}

function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search, href: 'http://localhost/' + search },
    writable: true,
    configurable: true
  });
}

describe('febpt-variant', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as unknown as { __ppFebptVariant?: VariantGlobal }).__ppFebptVariant;
    setSearch('');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('trigger query', () => {
    it('does not modify the DOM when source=febpt is absent', () => {
      setSearch('?other=value');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();

      const before = document.head.innerHTML;
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();
      expect(document.head.innerHTML).toBe(before);
    });

    it('runs when source=febpt is present', () => {
      setSearch('?source=febpt');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();
      expect(document.getElementById('febpt-variant-style')).not.toBeNull();
    });

    it('respects a custom triggerQuery override', () => {
      setSearch('?source=febpt-may');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!({ triggerQuery: 'source=febpt-may' });
      expect(document.getElementById('febpt-variant-style')).not.toBeNull();
    });
  });

  describe('CSS injection', () => {
    it('appends a style tag hiding the default selectors', () => {
      setSearch('?source=febpt');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();
      const style = document.getElementById('febpt-variant-style');
      expect(style).not.toBeNull();
      expect(style!.textContent).toContain('.ds-bg-primary-200.questionnaire-container-wrapper');
      expect(style!.textContent).toContain('display: none !important');
    });

    it('does not duplicate style tags on repeated invocations', () => {
      setSearch('?source=febpt');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      const fn = (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!;
      fn();
      fn();
      expect(document.querySelectorAll('#febpt-variant-style').length).toBe(1);
    });

    it('hides custom selectors via overrides', () => {
      setSearch('?source=febpt');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!({
        hideSelectors: ['.my-custom-class']
      });
      const style = document.getElementById('febpt-variant-style')!;
      expect(style.textContent).toContain('.my-custom-class');
    });
  });

  describe('text replacement', () => {
    it('applies text changes when target selectors are already rendered', () => {
      setSearch('?source=febpt');
      const h1 = document.createElement('h1');
      h1.className = 'lineheight-xsmall';
      h1.textContent = 'Original heading';
      document.body.appendChild(h1);

      const span = document.createElement('span');
      span.className = 'ds-text-primary-800 ds-body-m';
      span.textContent = 'Original description';
      document.body.appendChild(span);

      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();

      expect(h1.textContent).toBe("You're all set to begin your free treatment plan");
      expect(span.textContent).toContain('Add your payment details');
    });

    it('rewrites buttons matching the from-text', () => {
      setSearch('?source=febpt');
      const h1 = document.createElement('h1');
      h1.className = 'lineheight-xsmall';
      document.body.appendChild(h1);

      const span = document.createElement('span');
      span.className = 'ds-text-primary-800 ds-body-m';
      document.body.appendChild(span);

      const button = document.createElement('button');
      button.textContent = 'Pay Now';
      document.body.appendChild(button);

      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();

      expect(button.textContent).toBe('Add your card');
    });

    it('leaves non-matching buttons untouched', () => {
      setSearch('?source=febpt');
      const h1 = document.createElement('h1');
      h1.className = 'lineheight-xsmall';
      document.body.appendChild(h1);
      const span = document.createElement('span');
      span.className = 'ds-text-primary-800 ds-body-m';
      document.body.appendChild(span);
      const button = document.createElement('button');
      button.textContent = 'Continue';
      document.body.appendChild(button);

      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!();

      expect(button.textContent).toBe('Continue');
    });
  });

  describe('observer + diagnostic', () => {
    it('warns when selectors never match before timeout', () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      setSearch('?source=febpt');
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant = { disableAutoRun: true };
      loadVariant();
      (window as unknown as { __ppFebptVariant: VariantGlobal }).__ppFebptVariant.run!({
        observerTimeoutMs: 100
      });

      vi.advanceTimersByTime(150);

      expect(warnSpy).toHaveBeenCalled();
      const call = warnSpy.mock.calls[0];
      expect(String(call[0])).toContain('selectors did not match');
      expect(Array.isArray(call[1])).toBe(true);
    });
  });
});
