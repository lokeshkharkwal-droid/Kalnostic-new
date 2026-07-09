import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — doctor not found within the tenant. */
export class DoctorNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('DOCTOR_NOT_FOUND', 'Doctor not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/**
 * 409 — another active doctor in this tenant already uses this registration
 * number (per-tenant de-duplication key among active rows).
 */
export class DuplicateRegistrationNoException extends KaltrosException {
  constructor(registrationNo: string) {
    super(
      'DUPLICATE_REGISTRATION_NO',
      'A doctor with this registration number already exists',
      { registrationNo },
      HttpStatus.CONFLICT,
    );
  }
}
