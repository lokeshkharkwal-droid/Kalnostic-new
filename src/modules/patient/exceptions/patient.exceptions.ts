import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — patient not found within the tenant. */
export class PatientNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PATIENT_NOT_FOUND',
      'Patient not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active patient in this tenant already uses this mobile number. */
export class PatientMobileConflictException extends KaltrosException {
  constructor(mobile: string) {
    super(
      'PATIENT_MOBILE_CONFLICT',
      'A patient with this mobile number already exists',
      { mobile },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — medical-history record not found for the given patient/tenant. */
export class MedicalHistoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'MEDICAL_HISTORY_NOT_FOUND',
      'Medical history record not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
