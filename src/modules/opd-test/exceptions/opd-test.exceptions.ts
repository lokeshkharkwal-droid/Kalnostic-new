import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — opd test not found within the tenant / master data. */
export class OpdTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OPD_TEST_NOT_FOUND',
      'Opd test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active opd test in this master data already uses this name. */
export class OpdTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'OPD_TEST_NAME_CONFLICT',
      'A opd test with this name already exists in this master data',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active opd test in this master data already uses this code. */
export class OpdTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'OPD_TEST_CODE_CONFLICT',
      'A opd test with this code already exists in this master data',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — a opd test was created (or its samples cleared on update) without at
 * least one sample.
 */
export class OpdTestSampleRequiredException extends KaltrosException {
  constructor() {
    super(
      'OPD_TEST_SAMPLE_REQUIRED',
      'A opd test must have at least one sample',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 409 — duplicate parameter code within a opd test. */
export class OpdTestParamCodeConflictException extends KaltrosException {
  constructor(parameterCode: string) {
    super(
      'OPD_TEST_PARAM_CODE_CONFLICT',
      'A result parameter with this code already exists in this opd test',
      { parameterCode },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — a calculated parameter's `calculationFormula` is syntactically invalid, or
 * references itself.
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
 * 422 — a calculated parameter's formula references a parameter code that does not
 * exist in this opd test.
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

/** 422 — the calculated parameters form a circular dependency. */
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
