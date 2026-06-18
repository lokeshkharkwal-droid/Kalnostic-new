import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — external referral not found within the tenant. */
export class ExternalReferralNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'EXTERNAL_REFERRAL_NOT_FOUND',
      'External referral not found',
      { id },
      HttpStatus.NOT_FOUND,
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
      'EXTERNAL_REFERRAL_INVALID_LAB_TEST',
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
      'EXTERNAL_REFERRAL_INVALID_LAB_PANEL',
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
      'EXTERNAL_REFERRAL_INVALID_COMMISSION_CONFIG',
      'The commission or incentive configuration is invalid',
      { reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
