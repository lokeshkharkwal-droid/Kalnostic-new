import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — payment record not found within the tenant. */
export class PaymentDetailsNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PAYMENT_DETAILS_NOT_FOUND',
      'Payment record not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — the parent order does not exist in the caller's tenant. */
export class PaymentOrderNotFoundException extends KaltrosException {
  constructor(orderId: string) {
    super(
      'PAYMENT_ORDER_NOT_FOUND',
      'The referenced order does not exist in this tenant',
      { orderId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the payment would exceed the order's pending (net − already-paid) amount. */
export class PaymentOverpaymentException extends KaltrosException {
  constructor(pending: number, attempted: number) {
    super(
      'PAYMENT_OVERPAYMENT',
      'The payment amount exceeds the pending balance for this order',
      { pending, attempted },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the parent order is cancelled, so no further payments are allowed. */
export class PaymentOrderCancelledException extends KaltrosException {
  constructor(orderId: string) {
    super(
      'PAYMENT_ORDER_CANCELLED',
      'The referenced order is cancelled; no further payments are allowed',
      { orderId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
