import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — radiology test not found within the tenant / master data. */
export class RadiologyTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_TEST_NOT_FOUND',
      'Radiology test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active radiology test in this master data already uses this name. */
export class RadiologyTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'RADIOLOGY_TEST_NAME_CONFLICT',
      'A radiology test with this name already exists in this master data',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active radiology test in this master data already uses this code. */
export class RadiologyTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'RADIOLOGY_TEST_CODE_CONFLICT',
      'A radiology test with this code already exists in this master data',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}
