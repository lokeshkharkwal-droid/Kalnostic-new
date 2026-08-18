import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — an invoice could not be found in the caller's tenant. */
export class InvoiceNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'INVOICE_NOT_FOUND',
      'Invoice not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — no source outstanding records were supplied. */
export class InvoiceSourceOrdersEmptyException extends KaltrosException {
  constructor() {
    super(
      'INVOICE_SOURCE_ORDERS_EMPTY',
      'Select at least one outstanding record to create an invoice',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the selected records resolve to more than one invoice party. */
export class InvoiceMixedPartyException extends KaltrosException {
  constructor(context: Record<string, unknown> = {}) {
    super(
      'INVOICE_MIXED_PARTY',
      'All selected records must belong to the same invoice party',
      context,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the resolved gross amount is zero (nothing left to invoice). */
export class InvoiceZeroAmountException extends KaltrosException {
  constructor() {
    super(
      'INVOICE_ZERO_AMOUNT',
      'The selected records have no outstanding amount to invoice',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — one of the selected orders has already been invoiced. */
export class InvoiceOrderAlreadyInvoicedException extends KaltrosException {
  constructor(orderIds: string[]) {
    super(
      'INVOICE_ORDER_ALREADY_INVOICED',
      'One or more selected records have already been invoiced',
      { orderIds },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — a selected order does not resolve to an active order in the tenant. */
export class InvoiceOrderNotFoundException extends KaltrosException {
  constructor(orderIds: string[]) {
    super(
      'INVOICE_ORDER_NOT_FOUND',
      'One or more selected records could not be found',
      { orderIds },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — a selected order has no outstanding due for the chosen party. */
export class InvoiceOrderNotOutstandingException extends KaltrosException {
  constructor(orderIds: string[]) {
    super(
      'INVOICE_ORDER_NOT_OUTSTANDING',
      'One or more selected records have no outstanding due',
      { orderIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — a receipt amount exceeds the invoice's outstanding balance. */
export class InvoicePaymentExceedsOutstandingException extends KaltrosException {
  constructor(outstanding: number, attempted: number) {
    super(
      'INVOICE_PAYMENT_EXCEEDS_OUTSTANDING',
      'The amount received exceeds the outstanding balance',
      { outstanding, attempted },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — the invoice is already cancelled. */
export class InvoiceAlreadyCancelledException extends KaltrosException {
  constructor(id: string) {
    super(
      'INVOICE_ALREADY_CANCELLED',
      'This invoice is already cancelled',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — cancellation is blocked because the invoice already has payments. */
export class InvoiceCancelBlockedHasPaymentsException extends KaltrosException {
  constructor(id: string) {
    super(
      'INVOICE_CANCEL_BLOCKED_HAS_PAYMENTS',
      'This invoice cannot be cancelled because payments have been recorded against it',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — the invoice party master row could not be resolved. */
export class InvoicePartyResolutionException extends KaltrosException {
  constructor(partyType: string, partyId: string) {
    super(
      'INVOICE_PARTY_RESOLUTION_FAILED',
      'The invoice party could not be resolved',
      { partyType, partyId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the selected orders do not carry the chosen party type. */
export class InvoicePartyMismatchException extends KaltrosException {
  constructor(partyType: string, orderIds: string[]) {
    super(
      'INVOICE_PARTY_MISMATCH',
      'One or more selected records do not belong to the chosen invoice party type',
      { partyType, orderIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the tenant has no billing settings row to draw the invoice number from. */
export class BillingSettingNotConfiguredException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'BILLING_SETTING_NOT_CONFIGURED',
      'Billing settings are not configured for this business',
      { tenantId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
