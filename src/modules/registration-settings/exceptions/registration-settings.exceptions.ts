import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * Thrown when a save would leave more than one of
 * `ChargesAndDeductions_AllowOrderDiscountOnly` /
 * `ChargesAndDeductions_AllowLineDiscountOnly` /
 * `ChargesAndDeductions_AllowBothOrderAndLineDiscount` set to `true` at once —
 * per the LIMS Settings doc these three discount modes are mutually exclusive.
 */
export class ConflictingDiscountModeException extends KaltrosException {
  constructor() {
    super(
      'CONFLICTING_DISCOUNT_MODE',
      'Only one of AllowOrderDiscountOnly, AllowLineDiscountOnly, or AllowBothOrderAndLineDiscount may be enabled at a time',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * Thrown when the auto-generator cannot find a free external Order/Quote id —
 * every number it tried was already held by a live record in the branch (e.g.
 * a long run of hand-typed ids in the auto format).
 */
export class ExternalIdExhaustedException extends KaltrosException {
  constructor(purpose: string, attempts: number) {
    super(
      'EXTERNAL_ID_EXHAUSTED',
      'Could not generate a unique ID for this branch. Please try again or contact support.',
      { purpose, attempts },
      HttpStatus.CONFLICT,
    );
  }
}
