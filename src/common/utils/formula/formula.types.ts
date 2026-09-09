/**
 * Shared types for the dynamic/calculated-parameter formula engine.
 *
 * A formula is an infix arithmetic expression over parameter-code identifiers,
 * numeric literals and the operators `+ - * / ( )` (plus unary minus). It is used
 * in two places:
 *  - lab-test config: validate a parameter's `calculationFormula` (syntax,
 *    references, dependency cycles) before persisting the test.
 *  - lab-report result entry: evaluate a calculated parameter's value from the
 *    other entered parameter values of the same report.
 *
 * The engine is pure (no `eval`/`Function`) — identifiers only ever resolve
 * against the caller-supplied value map, never to code.
 */

/** Machine-readable outcome of evaluating a single formula. */
export type FormulaEvalError =
  | 'INVALID_SYNTAX' // could not tokenize/parse the expression
  | 'UNKNOWN_REF' // referenced a code with no entry in the value map
  | 'MISSING_INPUT' // a referenced code has no numeric value yet (blank input)
  | 'NON_NUMERIC' // a referenced value is present but not a finite number
  | 'DIV_ZERO'; // division (or modulo) by zero, or a non-finite result

/** Result of {@link evaluateFormula}. */
export type FormulaEvalResult =
  | { ok: true; value: number }
  | { ok: false; error: FormulaEvalError; ref?: string };

/** A parameter as seen by the dependency graph. */
export interface FormulaParam {
  /** Unique-per-test parameter code (the token used inside formulas). */
  code: string;
  /** True when this parameter derives its value from `formula`. */
  isCalculated: boolean;
  /** The calculation formula (only meaningful when `isCalculated`). */
  formula?: string | null;
}

/**
 * Result of validating a whole set of a test's formulas ({@link validateFormulaSet}).
 * On success it also returns the topological evaluation order (calculated codes,
 * dependencies first). On failure it names the offending parameter/reference so
 * the caller can raise a precise, typed exception.
 */
export type FormulaSetValidation =
  | { ok: true; order: string[] }
  | { ok: false; kind: 'SYNTAX'; code: string }
  | { ok: false; kind: 'SELF_REF'; code: string }
  | { ok: false; kind: 'UNKNOWN_REF'; code: string; ref: string }
  | { ok: false; kind: 'CYCLE'; cycle: string[] };

/** Hard limit on formula length — a defensive guard against pathological input. */
export const MAX_FORMULA_LENGTH = 500;
