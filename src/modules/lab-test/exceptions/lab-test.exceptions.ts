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

/**
 * 422 — a lab test was created (or its samples cleared on update) without at
 * least one `LabTestSample`. Every lab test must carry a sample so the order flow
 * can generate its `OrderSample` rows (one per test × sample).
 */
export class LabTestSampleRequiredException extends KaltrosException {
  constructor() {
    super(
      'LAB_TEST_SAMPLE_REQUIRED',
      'A lab test must have at least one sample',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
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
 * 422 — a calculated parameter's `calculationFormula` is syntactically invalid
 * (does not tokenize/parse), or references itself. `reason` distinguishes the
 * two so the client message is specific.
 */
export class InvalidFormulaException extends KaltrosException {
  constructor(parameterCode: string, reason: 'syntax' | 'self' = 'syntax') {
    super(
      'INVALID_FORMULA',
      reason === 'self'
        ? 'A calculated parameter cannot reference itself in its formula'
        : 'The calculation formula is invalid',
      { parameterCode, reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — a calculated parameter's formula references a parameter code that does
 * not exist in this lab test.
 */
export class UnknownFormulaReferenceException extends KaltrosException {
  constructor(parameterCode: string, ref: string) {
    super(
      'UNKNOWN_FORMULA_REFERENCE',
      `The calculation formula references an unknown parameter "${ref}"`,
      { parameterCode, ref },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the calculated parameters form a circular dependency (e.g. A depends on
 * B and B depends on A), which cannot be evaluated.
 */
export class CircularFormulaDependencyException extends KaltrosException {
  constructor(cycle: string[]) {
    super(
      'CIRCULAR_FORMULA_DEPENDENCY',
      `The calculation formulas form a circular dependency: ${cycle.join(' → ')}`,
      { cycle },
      HttpStatus.UNPROCESSABLE_ENTITY,
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
