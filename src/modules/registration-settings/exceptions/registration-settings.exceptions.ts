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
