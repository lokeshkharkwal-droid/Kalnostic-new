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
