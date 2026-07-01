import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — outsource center not found within the tenant. */
export class OutsourceCenterNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OUTSOURCE_CENTER_NOT_FOUND',
      'Outsource center not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active outsource center in this tenant already uses this name. */
export class OutsourceCenterNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'OUTSOURCE_CENTER_NAME_CONFLICT',
      'An outsource center with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the same contact role was provided more than once for a center. */
export class DuplicateContactRoleException extends KaltrosException {
  constructor(role: string) {
    super(
      'OUTSOURCE_CENTER_DUPLICATE_CONTACT_ROLE',
      'Each contact role can be provided at most once',
      { role },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the selected lab test is not an active lab test in this tenant
 * (soft-deleted, inactive, or non-existent).
 */
export class InvalidLabTestException extends KaltrosException {
  constructor(labTestId: string) {
    super(
      'OUTSOURCE_CENTER_INVALID_TEST',
      'The selected lab test is not a valid active lab test',
      { labTestId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the selected lab panel is not an active lab panel in this tenant
 * (soft-deleted, inactive, or non-existent).
 */
export class InvalidLabPanelException extends KaltrosException {
  constructor(labPanelId: string) {
    super(
      'OUTSOURCE_CENTER_INVALID_PANEL',
      'The selected lab panel is not a valid active lab panel',
      { labPanelId },
      HttpStatus.BAD_REQUEST,
    );
  }
}
