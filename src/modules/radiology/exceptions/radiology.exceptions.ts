import { HttpStatus } from '@nestjs/common';
import { RadiologyStudyStatus } from '@prisma/client';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** A radiology study was not found (missing / soft-deleted / other tenant). */
export class RadiologyStudyNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_STUDY_NOT_FOUND',
      'Radiology study not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** An action was attempted from a status the state machine does not allow. */
export class InvalidRadiologyStudyTransitionException extends KaltrosException {
  constructor(id: string, action: string, from: RadiologyStudyStatus) {
    super(
      'INVALID_RADIOLOGY_STUDY_TRANSITION',
      `Cannot ${action} a radiology study that is ${from}`,
      { id, action, from },
      HttpStatus.CONFLICT,
    );
  }
}

/** No active `radiology_report` PDF template is configured for the tenant/branch. */
export class NoRadiologyReportTemplateException extends KaltrosException {
  constructor() {
    super(
      'NO_RADIOLOGY_REPORT_TEMPLATE',
      'No active radiology report template is configured. Create one and set it as the Radiology Report default.',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
