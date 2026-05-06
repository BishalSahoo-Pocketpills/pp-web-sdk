/**
 * Typed error classes for the Voucherify module.
 *
 * Replaces ad-hoc `throw new Error(...)` sites so callers can discriminate
 * by class (config vs. transport vs. pricing-render failure) and so
 * structured logs carry an `errorClass` field instead of a free-form string.
 *
 * Each class sets `name` explicitly because TypeScript transpiles to ES5
 * Function-based subclasses where the inherited `name` would otherwise
 * remain `'Error'`.
 */

export interface VoucherifyErrorContext {
  endpoint?: string;
  status?: number;
  attempt?: number;
  cause?: string;
  // Free-form sanitized metadata for logs. NEVER put PII / secrets / customer
  // identifiers in here — the structured logger surfaces this verbatim.
  [key: string]: unknown;
}

export class VoucherifyError extends Error {
  readonly context?: VoucherifyErrorContext;
  constructor(message: string, context?: VoucherifyErrorContext) {
    super(message);
    this.name = 'VoucherifyError';
    this.context = context;
  }
}

/**
 * Misconfiguration / unsafe configuration. Thrown at init() and on any
 * code path that detects credentials/proxy URLs in an inconsistent state.
 */
export class VoucherifyConfigError extends VoucherifyError {
  constructor(message: string, context?: VoucherifyErrorContext) {
    super(message, context);
    this.name = 'VoucherifyConfigError';
  }
}

/**
 * Transport-layer failure: HTTP non-2xx, network error, retry exhausted.
 * `context.endpoint` and `context.status` should be populated where known.
 */
export class VoucherifyApiError extends VoucherifyError {
  constructor(message: string, context?: VoucherifyErrorContext) {
    super(message, context);
    this.name = 'VoucherifyApiError';
  }
}

/**
 * Pricing-pipeline-specific failure (DOM mapping, fallback emission).
 * Reserved for the public pricing surface; transport layer uses
 * VoucherifyApiError instead.
 */
export class VoucherifyPricingError extends VoucherifyError {
  constructor(message: string, context?: VoucherifyErrorContext) {
    super(message, context);
    this.name = 'VoucherifyPricingError';
  }
}
