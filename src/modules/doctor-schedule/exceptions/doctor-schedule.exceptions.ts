import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — doctor schedule not found within the tenant. */
export class DoctorScheduleNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'DOCTOR_SCHEDULE_NOT_FOUND',
      'Doctor schedule not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — the doctor has no active schedule configured. */
export class DoctorScheduleForDoctorNotFoundException extends KaltrosException {
  constructor(doctorId: string) {
    super(
      'DOCTOR_SCHEDULE_FOR_DOCTOR_NOT_FOUND',
      'This doctor has no active schedule configured',
      { doctorId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — an ACTIVE schedule already exists for this doctor at this branch. Only
 * one active schedule is allowed per doctor + branch.
 */
export class DoctorScheduleOverlapException extends KaltrosException {
  constructor(
    doctorId: string,
    branchId: string | null,
    conflictsWith: string,
  ) {
    super(
      'DOCTOR_SCHEDULE_OVERLAP',
      'An active schedule already exists for this doctor at this branch',
      { doctorId, branchId, conflictsWith },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the schedule configuration is internally invalid (bad time window,
 * break outside the working hours, non-positive duration, interval below
 * duration, negative buffer, etc.).
 */
export class InvalidScheduleConfigException extends KaltrosException {
  constructor(reason: string, context: Record<string, unknown> = {}) {
    super('INVALID_SCHEDULE_CONFIG', reason, context, HttpStatus.BAD_REQUEST);
  }
}

/**
 * 422 — the schedule cannot be deleted because it has future booked slots.
 * Booked appointments are never removed automatically.
 */
export class ScheduleHasBookingsException extends KaltrosException {
  constructor(id: string, bookedSlots: number) {
    super(
      'SCHEDULE_HAS_BOOKINGS',
      'This schedule has future booked slots and cannot be deleted',
      { id, bookedSlots },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — slot not found within the tenant. */
export class SlotNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('SLOT_NOT_FOUND', 'Slot not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 409 — the slot is already at full capacity and cannot be reserved. */
export class SlotFullException extends KaltrosException {
  constructor(id: string) {
    super(
      'SLOT_FULL',
      'This slot is already fully booked',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — the slot is in the past and is read-only (cannot be reserved/released). */
export class SlotInPastException extends KaltrosException {
  constructor(id: string) {
    super(
      'SLOT_IN_PAST',
      'This slot is in the past and cannot be modified',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — nothing to release; the slot has no booked patients. */
export class SlotNotBookedException extends KaltrosException {
  constructor(id: string) {
    super(
      'SLOT_NOT_BOOKED',
      'This slot has no booked patients to release',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}
