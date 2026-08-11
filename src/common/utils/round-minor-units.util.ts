import { TransformFnParams } from 'class-transformer';

/**
 * A `class-transformer` `@Transform` callback that rounds a numeric input to the
 * nearest whole number, leaving any non-numeric value untouched so the field's
 * validators still reject it.
 *
 * Used on monetary DTO fields that are stored as **integer minor units**: the
 * client may send a fractional value (e.g. a per-line discount computed from a
 * percentage, `12.5% of 1005 = 100.5`), which is coerced to a whole minor unit
 * here rather than failing an integer check. Percentage inputs that must keep
 * their fraction (e.g. `discountValue` in PERCENT mode) do NOT use this.
 *
 * @param params the transform params supplied by class-transformer
 * @returns the rounded integer when the value is a number, otherwise the value unchanged
 */
export function roundMinorUnits({ value }: TransformFnParams): unknown {
  const raw: unknown = value;
  return typeof raw === 'number' ? Math.round(raw) : raw;
}
