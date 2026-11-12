import { AgeUnit } from '@prisma/client';
import { ValidationException } from '../../../common/exceptions/kaltros.exception';
import { isAgeRangeValid } from '../../../common/utils/age-bounds.util';

/** The five Age Restriction columns of a lab test, as persisted. */
export interface AgeRestrictionColumns {
  isAgeRestricted: boolean;
  minAgeValue: number | null;
  minAgeUnit: AgeUnit | null;
  maxAgeValue: number | null;
  maxAgeUnit: AgeUnit | null;
}

/** The Age Restriction fields as they may arrive on a create/update body. */
export type AgeRestrictionInput = {
  [K in keyof AgeRestrictionColumns]?: AgeRestrictionColumns[K] | null;
};

const AGE_RESTRICTION_KEYS: (keyof AgeRestrictionColumns)[] = [
  'isAgeRestricted',
  'minAgeValue',
  'minAgeUnit',
  'maxAgeValue',
  'maxAgeUnit',
];

const NO_RESTRICTION: AgeRestrictionColumns = {
  isAgeRestricted: false,
  minAgeValue: null,
  minAgeUnit: null,
  maxAgeValue: null,
  maxAgeUnit: null,
};

/**
 * Resolve the Age Restriction columns to persist for a lab test create/update.
 *
 * - Disabled (`isAgeRestricted` false) → every bound is cleared (= no age limit).
 * - Enabled → all four bounds are required and Minimum Age must not be greater
 *   than Maximum Age (same calendar rule as reference ranges: the max covers its
 *   whole unit, so "18 Years .. 18 Years" is valid).
 *
 * On an update (`existing` given) a field missing from the body keeps its stored
 * value, and a body that touches none of the five fields returns `undefined` so
 * the columns are left exactly as they are.
 *
 * @param input the Age Restriction fields from the request body
 * @param existing the stored columns (update only)
 * @returns the five columns to write, or `undefined` to leave them unchanged
 * @throws ValidationException when enabled with a missing bound or min > max
 */
export function resolveAgeRestriction(
  input: AgeRestrictionInput,
  existing?: AgeRestrictionColumns,
): AgeRestrictionColumns | undefined {
  const touched = AGE_RESTRICTION_KEYS.some((k) => input[k] !== undefined);
  if (existing && !touched) return undefined;

  const base = existing ?? NO_RESTRICTION;
  const pick = <K extends keyof AgeRestrictionColumns>(
    key: K,
  ): AgeRestrictionColumns[K] | null =>
    input[key] !== undefined ? (input[key] ?? null) : base[key];

  if (!(pick('isAgeRestricted') ?? false)) return { ...NO_RESTRICTION };

  const minAgeValue = pick('minAgeValue');
  const minAgeUnit = pick('minAgeUnit');
  const maxAgeValue = pick('maxAgeValue');
  const maxAgeUnit = pick('maxAgeUnit');
  if (
    minAgeValue === null ||
    minAgeUnit === null ||
    maxAgeValue === null ||
    maxAgeUnit === null
  ) {
    throw new ValidationException(
      'Minimum Age and Maximum Age are required when Age Restriction is Yes',
      { minAgeValue: 'missing', maxAgeValue: 'missing' },
    );
  }
  if (
    !isAgeRangeValid(
      { value: minAgeValue, unit: minAgeUnit },
      { value: maxAgeValue, unit: maxAgeUnit },
    )
  ) {
    throw new ValidationException(
      'Minimum Age must not be greater than Maximum Age',
      {
        minAge: `${minAgeValue} ${minAgeUnit}`,
        maxAge: `${maxAgeValue} ${maxAgeUnit}`,
      },
    );
  }
  return {
    isAgeRestricted: true,
    minAgeValue,
    minAgeUnit,
    maxAgeValue,
    maxAgeUnit,
  };
}
