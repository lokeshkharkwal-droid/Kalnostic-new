import type { Prisma } from '@prisma/client';

/**
 * The filter that finds a sample by the barcode a person typed or scanned.
 *
 * The match is exact and ignores capitals ("AbC-77" finds "abc-77"). Prisma sends a case-insensitive match to the
 * database as a pattern match (`ILIKE`), and a backslash does not switch that off, so `%` and `_` would act as
 * wildcards: `9901_` opened barcode 99011 instead of 99010. A barcode can legitimately hold an underscore (a branch
 * may choose it as the separator, `LAB_10001`), so such a code is matched with plain equality instead: wildcard-safe,
 * and exact in its capitals (the scanned label always has the exact value). `%` and `\` can never be part of a barcode;
 * the search rejects them before they get here.
 * @param code the trimmed barcode
 */
export function barcodeEquals(code: string): {
  equals: string;
  mode?: Prisma.QueryMode;
} {
  return /[%_\\]/.test(code)
    ? { equals: code }
    : { equals: code, mode: 'insensitive' };
}
