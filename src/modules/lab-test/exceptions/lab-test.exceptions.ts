import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — lab test not found within the tenant / master data. */
export class LabTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_TEST_NOT_FOUND',
      'Lab test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active lab test in this master data already uses this name. */
export class LabTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'LAB_TEST_NAME_CONFLICT',
      'A lab test with this name already exists in this master data',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active lab test in this master data already uses this code. */
export class LabTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'LAB_TEST_CODE_CONFLICT',
      'A lab test with this code already exists in this master data',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — duplicate parameter code within a lab test. */
export class LabTestParamCodeConflictException extends KaltrosException {
  constructor(parameterCode: string) {
    super(
      'LAB_TEST_PARAM_CODE_CONFLICT',
      'A result parameter with this code already exists in this lab test',
      { parameterCode },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — a bulk import was rejected because one or more rows failed validation.
 * The per-row, row-numbered messages are surfaced to the client as the envelope
 * `message` array (the global filter/interceptor pass `string[]` through verbatim,
 * exactly like the global ValidationPipe does). Nothing is saved.
 */
export class LabTestImportValidationException extends KaltrosException {
  constructor(messages: string[]) {
    super(
      'LAB_TEST_IMPORT_VALIDATION_FAILED',
      // The envelope `message` accepts string | string[]; KaltrosException types
      // it as string, so cast locally to pass the per-row list through.
      messages as unknown as string,
      { count: messages.length },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
