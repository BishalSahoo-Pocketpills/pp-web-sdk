/**
 * Voucherify price / discount label formatting.
 *
 * Pure helpers extracted from voucherify/index.ts so they can be tested
 * in isolation and reused by future modules (e.g. a CMS-rendered
 * pricing component). Carry no closure state — the formatter cache
 * lives inside `createPriceFormatter` so callers can hold one per
 * locale/currency pair without leaking globals.
 */

import type { PPLib } from '@src/types/common.types';

export interface PriceFormatterConfig {
  locale: string;
  currency: string;
  currencySymbol: string;
}

export interface PriceFormatter {
  format: (amount: number) => string;
}

/**
 * Build a price formatter for a fixed locale + currency. The underlying
 * `Intl.NumberFormat` is constructed lazily on first format() and reused
 * — instantiating Intl is non-trivial (~1ms), so callers that format
 * many prices benefit from one shared formatter.
 *
 * Falls back to `currencySymbol + amount.toFixed(2)` if `Intl` throws.
 * That branch is unreachable in jsdom but real browsers can throw for
 * non-recognized locale tags.
 */
export function createPriceFormatter(config: PriceFormatterConfig): PriceFormatter {
  let intl: Intl.NumberFormat | null = null;

  function get(): Intl.NumberFormat {
    if (!intl) {
      intl = new Intl.NumberFormat(config.locale, {
        style: 'currency',
        currency: config.currency,
      });
    }
    return intl;
  }

  return {
    format(amount: number): string {
      try {
        return get().format(amount);
      /*! v8 ignore start — Intl.NumberFormat.format() never throws in jsdom */
      } catch (e) {
        return config.currencySymbol + amount.toFixed(2);
      }
      /*! v8 ignore stop */
    },
  };
}

/**
 * Build the human-readable discount label shown next to the price.
 *
 *   PERCENT     → "20% OFF"
 *   AMOUNT/FIXED → "$3.00 OFF"
 *   anything else → ""  (logged at warn level so the upstream Voucherify
 *                        campaign config can be audited)
 *
 * Takes the formatter as a parameter so the same Intl instance is shared
 * with the surrounding pricing engine (no double-init cost).
 */
export function buildDiscountLabel(
  discountType: string,
  discountAmount: number,
  basePrice: number,
  formatter: PriceFormatter,
  log: PPLib['log'],
): string {
  if (discountType === 'PERCENT') {
    const percent = Math.round((discountAmount / basePrice) * 100);
    return percent + '% OFF';
  }
  if (discountType === 'AMOUNT' || discountType === 'FIXED') {
    return formatter.format(discountAmount) + ' OFF';
  }
  log('warn', '[ppVoucherify] Unknown discount type: ' + discountType);
  return '';
}
