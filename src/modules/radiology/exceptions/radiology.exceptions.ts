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

/** No active `radiology_all_report` PDF template is configured for the tenant/branch. */
export class NoRadiologyAllReportTemplateException extends KaltrosException {
  constructor() {
    super(
      'NO_RADIOLOGY_ALL_REPORT_TEMPLATE',
      'No active radiology all-report template is configured. Create one of type "Radiology All Reports" and set it as the default.',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** A combined radiology report was requested but none of the given study ids
 *  resolved to an accessible study (all missing / soft-deleted / other tenant). */
export class NoRadiologyStudiesSelectedException extends KaltrosException {
  constructor() {
    super(
      'NO_RADIOLOGY_STUDIES_SELECTED',
      'No radiology studies were found for the selected ids',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** The chosen radiology certificate template was not found / inactive. */
export class RadiologyCertificateTemplateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_CERTIFICATE_TEMPLATE_NOT_FOUND',
      'Radiology certificate template not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * A certificate print/render was attempted for a study whose report has not been
 * filled yet (no `reportedAt`). A certificate can only be printed once the report
 * exists — enforced server-side so no alternative path can print an unfilled one.
 */
export class RadiologyReportNotFilledException extends KaltrosException {
  constructor(studyId: string) {
    super(
      'RADIOLOGY_REPORT_NOT_FILLED',
      'Cannot print a certificate before the report is filled',
      { studyId },
      HttpStatus.CONFLICT,
    );
  }
}

/** An issued radiology certificate was not found (missing / soft-deleted / other tenant). */
export class RadiologyCertificateIssuedNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_CERTIFICATE_ISSUED_NOT_FOUND',
      'Issued radiology certificate not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
