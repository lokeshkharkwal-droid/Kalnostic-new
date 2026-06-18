import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — internal referral not found within the tenant. */
export class InternalReferralNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'INTERNAL_REFERRAL_NOT_FOUND',
      'Internal referral not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 422 — the supplied `employeeId` does not reference an active staff member of this
 * tenant.
 */
export class InvalidEmployeeRefException extends KaltrosException {
  constructor(employeeId: string) {
    super(
      'INTERNAL_REFERRAL_INVALID_EMPLOYEE',
      'The employee does not reference an active staff member of this tenant',
      { employeeId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — one or more assigned `labTestId`s do not reference an active lab test in
 * this tenant.
 */
export class InvalidLabTestRefException extends KaltrosException {
  constructor(labTestIds: string[]) {
    super(
      'INTERNAL_REFERRAL_INVALID_LAB_TEST',
      'One or more assigned lab tests do not reference an active lab test',
      { labTestIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — one or more assigned `labPanelId`s do not reference an active lab panel in
 * this tenant.
 */
export class InvalidLabPanelRefException extends KaltrosException {
  constructor(labPanelIds: string[]) {
    super(
      'INTERNAL_REFERRAL_INVALID_LAB_PANEL',
      'One or more assigned lab panels do not reference an active lab panel',
      { labPanelIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the commission/incentive configuration is internally inconsistent (e.g. a
 * required conditional field is missing, or a slab band is inverted). `reason`
 * carries the specific rule for server-side logging.
 */
export class InvalidCommissionConfigException extends KaltrosException {
  constructor(reason: string) {
    super(
      'INTERNAL_REFERRAL_INVALID_COMMISSION_CONFIG',
      'The commission or incentive configuration is invalid',
      { reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
