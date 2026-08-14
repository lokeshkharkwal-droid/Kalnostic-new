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

/** 400 — a UMID is required (the branch's patient id format is NONE / manual). */
export class PatientUmIdRequiredException extends KaltrosException {
  constructor() {
    super(
      'PATIENT_UMID_REQUIRED',
      'A UMID is required for this patient',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 409 — another patient already uses this UMID (globally-unique). */
export class PatientUmIdConflictException extends KaltrosException {
  constructor(umId: string) {
    super(
      'PATIENT_UMID_CONFLICT',
      'A patient with this UMID already exists',
      { umId },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — could not allocate a unique UMID after several attempts (persistent
 * collisions on the auto-increment sequence). Retryable.
 */
export class UmIdGenerationConflictException extends KaltrosException {
  constructor(attempts: number) {
    super(
      'UMID_GENERATION_CONFLICT',
      'Could not generate a unique UMID, please retry',
      { attempts },
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

/** 404 — family link not found for the given anchor patient/tenant. */
export class FamilyLinkNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'FAMILY_LINK_NOT_FOUND',
      'Family member link not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — patient document / consent record not found for the given patient/tenant. */
export class PatientDocumentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PATIENT_DOCUMENT_NOT_FOUND',
      'Patient document not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}
