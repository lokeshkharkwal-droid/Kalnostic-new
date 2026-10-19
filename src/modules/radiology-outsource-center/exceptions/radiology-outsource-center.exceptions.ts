import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — radiology outsource center not found within the tenant. */
export class RadiologyOutsourceCenterNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_OUTSOURCE_CENTER_NOT_FOUND',
      'Radiology outsource center not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — another active radiology outsource center in this tenant already uses this
 * name.
 */
export class RadiologyOutsourceCenterNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'RADIOLOGY_OUTSOURCE_CENTER_NAME_CONFLICT',
      'A radiology outsource center with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the selected radiology test is not an active radiology test in this tenant
 * (soft-deleted, inactive, or non-existent).
 */
export class InvalidRadiologyTestException extends KaltrosException {
  constructor(radiologyTestId: string) {
    super(
      'RADIOLOGY_OUTSOURCE_CENTER_INVALID_TEST',
      'The selected radiology test is not a valid active radiology test',
      { radiologyTestId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the selected radiology panel is not an active radiology panel in this
 * tenant (soft-deleted, inactive, or non-existent).
 */
export class InvalidRadiologyPanelException extends KaltrosException {
  constructor(radiologyPanelId: string) {
    super(
      'RADIOLOGY_OUTSOURCE_CENTER_INVALID_PANEL',
      'The selected radiology panel is not a valid active radiology panel',
      { radiologyPanelId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — a Radiology Test List / Panel List was selected but the caller has no
 * active branch on the JWT to validate it against.
 */
export class ActiveBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'RADIOLOGY_OUTSOURCE_CENTER_ACTIVE_BRANCH_REQUIRED',
      'An active branch is required to assign a radiology list',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
