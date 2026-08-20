import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — a settlement could not be found in the caller's tenant. */
export class SettlementNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SETTLEMENT_NOT_FOUND',
      'Settlement not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — no source collection records were supplied. */
export class SettlementSourcePaymentsEmptyException extends KaltrosException {
  constructor() {
    super(
      'SETTLEMENT_SOURCE_PAYMENTS_EMPTY',
      'Select at least one collection record to create a settlement',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — a selected payment does not resolve to an active payment in the tenant. */
export class SettlementPaymentNotFoundException extends KaltrosException {
  constructor(paymentIds: string[]) {
    super(
      'SETTLEMENT_PAYMENT_NOT_FOUND',
      'One or more selected records could not be found',
      { paymentIds },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — one or more selected payments are already FULLY settled (no remaining). */
export class SettlementPaymentFullySettledException extends KaltrosException {
  constructor(paymentIds: string[]) {
    super(
      'SETTLEMENT_PAYMENT_FULLY_SETTLED',
      'One or more selected records are already fully settled',
      { paymentIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the selected payments' orders do not carry the chosen party type. */
export class SettlementPartyMismatchException extends KaltrosException {
  constructor(partyType: string, paymentIds: string[]) {
    super(
      'SETTLEMENT_PARTY_MISMATCH',
      'One or more selected records do not belong to the chosen settlement party type',
      { partyType, paymentIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the selected records resolve to more than one settlement party. */
export class SettlementMixedPartyException extends KaltrosException {
  constructor(context: Record<string, unknown> = {}) {
    super(
      'SETTLEMENT_MIXED_PARTY',
      'All selected records must belong to the same settlement party',
      context,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the settlement party master row could not be resolved. */
export class SettlementPartyResolutionException extends KaltrosException {
  constructor(partyType: string, partyId: string) {
    super(
      'SETTLEMENT_PARTY_RESOLUTION_FAILED',
      'The settlement party could not be resolved',
      { partyType, partyId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the resolved collected (paid) basis is zero (nothing to settle). */
export class SettlementZeroAmountException extends KaltrosException {
  constructor() {
    super(
      'SETTLEMENT_ZERO_AMOUNT',
      'The selected records have no collected amount to settle',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — the settlement is not in a status that permits the requested transition. */
export class SettlementInvalidStatusException extends KaltrosException {
  constructor(id: string, current: string, action: string) {
    super(
      'SETTLEMENT_INVALID_STATUS',
      `This settlement cannot be ${action} in its current state`,
      { id, current, action },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a settle action was attempted before the settlement was approved. */
export class SettlementNotApprovedException extends KaltrosException {
  constructor(id: string, current: string) {
    super(
      'SETTLEMENT_NOT_APPROVED',
      'This settlement must be approved before it can be settled',
      { id, current },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — a payout amount exceeds the remaining settlement balance. */
export class SettlementOverSettlementException extends KaltrosException {
  constructor(balance: number, attempted: number) {
    super(
      'SETTLEMENT_OVER_SETTLEMENT',
      'The settlement amount exceeds the remaining balance',
      { balance, attempted },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the approved amount exceeds the order's collected amount not already
 * committed to other settlements (guarantees total settled ≤ collected).
 */
export class SettlementApprovedExceedsBasisException extends KaltrosException {
  constructor(maxApprovable: number, attempted: number) {
    super(
      'SETTLEMENT_APPROVED_EXCEEDS_BASIS',
      'The approved amount cannot exceed the collected amount not already committed to other settlements',
      { maxApprovable, attempted },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — an edit would set the approved amount below the amount already settled. */
export class SettlementEditBlockedException extends KaltrosException {
  constructor(settledAmount: number, attempted: number) {
    super(
      'SETTLEMENT_EDIT_BLOCKED',
      'The approved amount cannot be less than the amount already settled',
      { settledAmount, attempted },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
