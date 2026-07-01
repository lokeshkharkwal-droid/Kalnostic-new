import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — payment rule not found (missing or soft-deleted). */
export class PaymentRuleNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PAYMENT_RULE_NOT_FOUND',
      'Payment rule not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active payment rule already uses this code. */
export class PaymentRuleCodeConflictException extends KaltrosException {
  constructor(code: string) {
    super(
      'PAYMENT_RULE_CODE_CONFLICT',
      'A payment rule with this code already exists',
      { code },
      HttpStatus.CONFLICT,
    );
  }
}
