import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — test group not found (missing or soft-deleted). */
export class TestGroupNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'TEST_GROUP_NOT_FOUND',
      'Test group not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active test group already uses this name. */
export class TestGroupNameConflictException extends KaltrosException {
  constructor(groupName: string) {
    super(
      'TEST_GROUP_NAME_CONFLICT',
      'A test group with this name already exists',
      { groupName },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — one or more selected `labTestId`s do not reference an active SITE_ADMIN
 * lab-test template.
 */
export class TestGroupLabTestNotFoundException extends KaltrosException {
  constructor(labTestIds: string[]) {
    super(
      'TEST_GROUP_LAB_TEST_NOT_FOUND',
      'One or more selected lab tests do not reference an active Site Admin lab test',
      { labTestIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
