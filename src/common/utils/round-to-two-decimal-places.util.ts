import { Prisma } from '@prisma/client';
import { TransformFnParams } from 'class-transformer';

/**
 * Round a finite number to 2 decimal places using exact decimal semantics
 * (via `Prisma.Decimal`), not naive `Math.round(v * 100) / 100` — the naive
 * form mis-rounds values like `1.005` because `1.005 * 100` is not exactly
 * `100.5` in IEEE754 binary floating point.
 */
export function roundToTwoDecimalPlaces(value: number): number {
  return new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();
}

/**
 * A `class-transformer` `@Transform` callback that rounds a numeric input to
 * 2 decimal places via {@link roundToTwoDecimalPlaces}, leaving any
 * non-numeric value untouched so the field's validators still reject it.
 *
 * Used on monetary DTO fields (rupees, up to 2 decimal places): the client
 * may send a value with more precision than currency allows (e.g. a per-line
 * discount computed from a percentage, `12.5% of 1005.33 = 125.66625`), which
 * is rounded to the nearest paisa here rather than failing validation.
 *
 * @param params the transform params supplied by class-transformer
 * @returns the rounded number when the value is numeric, otherwise the value unchanged
 */
export function roundToTwoDecimalPlacesTransform({
  value,
}: TransformFnParams): unknown {
  const raw: unknown = value;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? roundToTwoDecimalPlaces(raw)
    : raw;
}
