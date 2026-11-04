import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 404 — the public order page could not be resolved. Deliberately GENERIC: it
 * is thrown for every failure of the tenant → branch → order ownership chain
 * (missing/inactive tenant, branch not in the tenant or inactive, order not in
 * the branch/tenant, or not a finalized ORDER). Collapsing them into one code
 * stops an unauthenticated caller from probing which of the URL ids is wrong.
 * The real reason is kept in the server-side `context`, never returned.
 */
export class PublicOrderNotFoundException extends KaltrosException {
  constructor(
    tenantId: string,
    branchId: string,
    orderId: string,
    reason: string,
  ) {
    super(
      'PUBLIC_ORDER_NOT_FOUND',
      'This order is not available',
      { tenantId, branchId, orderId, reason },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 403 — the patient tried to print a bill whose payment status is not in the
 * branch's QR Code Scan Settings `billPrintablePaymentStatuses`. The page
 * already disables the button for this case; this is the server-side backstop so
 * the rule cannot be bypassed by hitting the PDF URL directly.
 */
export class PublicBillNotPrintableException extends KaltrosException {
  constructor(orderId: string, status: string) {
    super(
      'PUBLIC_BILL_NOT_PRINTABLE',
      'This bill is not available to print',
      { orderId, status },
      HttpStatus.FORBIDDEN,
    );
  }
}
