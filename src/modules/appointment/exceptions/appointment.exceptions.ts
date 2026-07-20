import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — appointment not found within the caller's tenant/branch. */
export class AppointmentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'APPOINTMENT_NOT_FOUND',
      'Appointment not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — a per-tenant appointment `code` collision among active rows. The code is
 * system-generated from `Tenant.appointmentCounter`; a collision indicates a
 * concurrent-counter race and is safe to retry.
 */
export class AppointmentCodeConflictException extends KaltrosException {
  constructor(code: string) {
    super(
      'APPOINTMENT_CODE_CONFLICT',
      'Appointment code already exists; please retry',
      { code },
      HttpStatus.CONFLICT,
    );
  }
}
