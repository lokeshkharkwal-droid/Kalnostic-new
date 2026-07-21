import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — equipment not found (missing or soft-deleted). */
export class EquipmentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'EQUIPMENT_NOT_FOUND',
      'Equipment not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active equipment already uses this name. */
export class EquipmentNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'EQUIPMENT_NAME_CONFLICT',
      'An equipment with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — one or more selected `labTestId`s do not reference an active SITE_ADMIN
 * lab-test template.
 */
export class EquipmentLabTestNotFoundException extends KaltrosException {
  constructor(labTestIds: string[]) {
    super(
      'EQUIPMENT_LAB_TEST_NOT_FOUND',
      'One or more selected lab tests do not reference an active Site Admin lab test',
      { labTestIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
