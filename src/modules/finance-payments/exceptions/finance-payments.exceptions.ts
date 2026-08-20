import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * Thrown when a `branchId` filter does not resolve to an active branch in the
 * caller's tenant — a client must never scope the ledger to another tenant's branch.
 */
export class FinancePaymentBranchNotFoundException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'FINANCE_PAYMENT_BRANCH_NOT_FOUND',
      'Branch not found',
      { branchId },
      HttpStatus.NOT_FOUND,
    );
  }
}
