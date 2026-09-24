import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../common/exceptions/kaltros.exception';

/**
 * Typed exceptions for the Referral Panel Settings credit gate (Section 4 —
 * Referral Panel Settings). Order-creation blocks are `422` (a rule the caller
 * can resolve by clearing dues, mirroring `PreviousDuesNotClearedException`);
 * report-access blocks are `403` (the client is not permitted to pull the
 * report until their account is settled). `context` is logged server-side only.
 */

/** 422 — a Cash/Postpaid referral's outstanding has reached its Credit Limit. */
export class ReferralOrderCreditLimitException extends KaltrosException {
  constructor(settingName: string, outstanding: number, creditLimit: number) {
    super(
      'REFERRAL_CREDIT_LIMIT_REACHED',
      `This referral's outstanding balance (${outstanding}) has reached its credit limit (${creditLimit}). Clear the outstanding before creating a new order.`,
      { settingName, outstanding, creditLimit },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — a referral's outstanding has been unpaid beyond Credit Allowed Days. */
export class ReferralOrderCreditDaysException extends KaltrosException {
  constructor(settingName: string, ageDays: number, creditAllowedDays: number) {
    super(
      'REFERRAL_CREDIT_DAYS_EXCEEDED',
      `This referral has an outstanding balance unpaid for ${ageDays} day(s), beyond the allowed ${creditAllowedDays} day(s). Settle it before creating a new order.`,
      { settingName, ageDays, creditAllowedDays },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 403 — report access blocked because the referral has reached its Credit Limit. */
export class ReferralReportCreditLimitException extends KaltrosException {
  constructor(settingName: string, outstanding: number, creditLimit: number) {
    super(
      'REFERRAL_REPORT_CREDIT_LIMIT_BLOCKED',
      `Report access is restricted: this referral's outstanding balance (${outstanding}) has reached its credit limit (${creditLimit}).`,
      { settingName, outstanding, creditLimit },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 403 — report access blocked because the referral exceeded Credit Allowed Days. */
export class ReferralReportCreditDaysException extends KaltrosException {
  constructor(settingName: string, ageDays: number, creditAllowedDays: number) {
    super(
      'REFERRAL_REPORT_CREDIT_DAYS_BLOCKED',
      `Report access is restricted: this referral has an outstanding balance unpaid for ${ageDays} day(s), beyond the allowed ${creditAllowedDays} day(s).`,
      { settingName, ageDays, creditAllowedDays },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 422 — the order's referral panel settings disable sending this deliverable
 * (bill/report) to the chosen recipient (patient / B2B panel / doctor), per the
 * Communication toggles in Section 4.
 */
export class CommunicationRecipientNotAllowedException extends KaltrosException {
  constructor(deliverable: 'bill' | 'report', recipient: string) {
    super(
      'COMMUNICATION_RECIPIENT_NOT_ALLOWED',
      `The referral panel's settings do not allow sending the ${deliverable} to the ${recipient}. Enable it in Referral Panel Settings → Communication.`,
      { deliverable, recipient },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
