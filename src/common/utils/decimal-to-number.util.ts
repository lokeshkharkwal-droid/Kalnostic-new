import { Prisma } from '@prisma/client';

/**
 * Convert a Prisma `Decimal` money field to a plain `number`, defaulting to 0
 * for `null`/`undefined` (e.g. an `_sum` aggregate over zero rows). Accepts an
 * already-plain `number` unchanged, since some call sites read from both a
 * fresh Prisma row and an already-converted value.
 *
 * A raw `Prisma.Decimal` must never be used directly in arithmetic — its `+`
 * operator string-concatenates (`Decimal.valueOf()` returns a string), which
 * silently produces the wrong result instead of throwing.
 */
export function toNum(
  value: Prisma.Decimal | number | null | undefined,
): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}
