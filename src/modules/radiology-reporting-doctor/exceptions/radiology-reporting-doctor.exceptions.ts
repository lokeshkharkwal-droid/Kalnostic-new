import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — radiology reporting doctor not found within the tenant. */
export class RadiologyReportingDoctorNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_REPORTING_DOCTOR_NOT_FOUND',
      'Radiology reporting doctor not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — another active radiology reporting doctor in this tenant already uses this
 * registration number (per-tenant de-duplication key among active rows).
 */
export class DuplicateRadiologyReportingDoctorRegistrationNoException extends KaltrosException {
  constructor(registrationNo: string) {
    super(
      'RADIOLOGY_REPORTING_DOCTOR_DUPLICATE_REGISTRATION_NO',
      'A radiology reporting doctor with this registration number already exists',
      { registrationNo },
      HttpStatus.CONFLICT,
    );
  }
}
