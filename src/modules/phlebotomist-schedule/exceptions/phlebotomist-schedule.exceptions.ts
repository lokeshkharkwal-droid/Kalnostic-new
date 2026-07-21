import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — phlebotomist schedule not found within the tenant. */
export class PhlebotomistScheduleNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PHLEBOTOMIST_SCHEDULE_NOT_FOUND',
      'Phlebotomist schedule not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — the phlebotomist has no active schedule configured. */
export class PhlebotomistScheduleForStaffNotFoundException extends KaltrosException {
  constructor(phlebotomistId: string) {
    super(
      'PHLEBOTOMIST_SCHEDULE_FOR_STAFF_NOT_FOUND',
      'This phlebotomist has no active schedule configured',
      { phlebotomistId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 404 — the referenced person is not an active phlebotomist at the caller's
 * branch (not a staff Person holding the `phlebotomist` role, or inactive).
 */
export class PhlebotomistNotFoundException extends KaltrosException {
  constructor(phlebotomistId: string) {
    super(
      'PHLEBOTOMIST_NOT_FOUND',
      'No active phlebotomist found for this branch',
      { phlebotomistId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — an ACTIVE schedule already exists for this phlebotomist at this branch.
 * Only one active schedule is allowed per phlebotomist + branch (this also blocks
 * duplicate/overlapping schedules).
 */
export class PhlebotomistScheduleOverlapException extends KaltrosException {
  constructor(
    phlebotomistId: string,
    branchId: string | null,
    conflictsWith: string,
  ) {
    super(
      'PHLEBOTOMIST_SCHEDULE_OVERLAP',
      'An active schedule already exists for this phlebotomist at this branch',
      { phlebotomistId, branchId, conflictsWith },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the schedule configuration is internally invalid (bad time window,
 * non-positive interval, negative travel buffer, non-positive max visits/day or
 * slot capacity, missing days for WEEKLY/CUSTOM recurrence, etc.).
 */
export class InvalidPhlebScheduleConfigException extends KaltrosException {
  constructor(reason: string, context: Record<string, unknown> = {}) {
    super(
      'INVALID_PHLEBOTOMIST_SCHEDULE_CONFIG',
      reason,
      context,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 422 — the schedule cannot be deleted because it has future booked visits.
 * Booked visits are never removed automatically.
 */
export class PhlebScheduleHasBookingsException extends KaltrosException {
  constructor(id: string, bookedSlots: number) {
    super(
      'PHLEBOTOMIST_SCHEDULE_HAS_BOOKINGS',
      'This schedule has future booked visits and cannot be deleted',
      { id, bookedSlots },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — service zone not found within the tenant/branch. */
export class ServiceZoneNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SERVICE_ZONE_NOT_FOUND',
      'Service zone not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active service zone already uses this name at the branch. */
export class ServiceZoneNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'SERVICE_ZONE_NAME_CONFLICT',
      'A service zone with this name already exists at this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — one or more zone ids don't belong to the caller's tenant/branch. */
export class InvalidServiceZonesException extends KaltrosException {
  constructor(zoneIds: string[]) {
    super(
      'INVALID_SERVICE_ZONES',
      'One or more service zones are invalid for this branch',
      { zoneIds },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the caller's JWT has no active branch, but the operation is branch-level.
 */
export class ActiveBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'ACTIVE_BRANCH_REQUIRED',
      'An active branch is required for this operation. Switch to a branch profile.',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 422 — the requested home-visit collection time does not map to any bookable
 * slot for this phlebotomist (outside the working window, a holiday/off-day, or a
 * past date/time). The phlebotomist's availability drives which slots exist.
 */
export class SlotUnavailableException extends KaltrosException {
  constructor(phlebotomistId: string, collectionAt: string) {
    super(
      'PHLEBOTOMIST_SLOT_UNAVAILABLE',
      'The selected collection time is not available for this phlebotomist',
      { phlebotomistId, collectionAt },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 409 — the selected slot has reached its capacity (`slotCapacity`). Another
 * booking took the last opening; the client should refresh availability and pick
 * a different slot.
 */
export class SlotFullException extends KaltrosException {
  constructor(phlebotomistId: string, collectionAt: string) {
    super(
      'PHLEBOTOMIST_SLOT_FULL',
      'This time slot is fully booked for the selected phlebotomist',
      { phlebotomistId, collectionAt },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — the phlebotomist's daily cap (`maxVisitsPerDay`) is reached for the
 * selected date. No further home visits can be booked that day.
 */
export class DailyCapReachedException extends KaltrosException {
  constructor(phlebotomistId: string, loadDate: string) {
    super(
      'PHLEBOTOMIST_DAILY_CAP_REACHED',
      'This phlebotomist has reached the maximum visits for the selected day',
      { phlebotomistId, loadDate },
      HttpStatus.CONFLICT,
    );
  }
}
