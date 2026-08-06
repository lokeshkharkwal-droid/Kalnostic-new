import { ListPriceSource, ListPriceType } from '@prisma/client';

/**
 * The five catalogue price columns a pricing list can copy from (shared by both
 * `BranchLabTest` and `BranchLabPanel`, which carry identical column names).
 */
export interface SourcePriceColumns {
  priceMsrp: number;
  priceMaximum: number;
  priceMinimum: number;
  priceOriginal: number;
  franchisePrice: number;
}

/**
 * Read the catalogue price column named by a `ListPriceSource` off a row. Defaults
 * to MSRP for an unknown source (defensive; the enum is closed).
 * @param row a row carrying the five price columns (minor units)
 * @param source the selected source column
 * @returns the source price in minor units
 */
export function resolveSourcePrice(
  row: SourcePriceColumns,
  source: ListPriceSource,
): number {
  switch (source) {
    case 'MAXIMUM':
      return row.priceMaximum;
    case 'MINIMUM':
      return row.priceMinimum;
    case 'ORIGINAL':
      return row.priceOriginal;
    case 'FRANCHISE':
      return row.franchisePrice;
    case 'MSRP':
    default:
      return row.priceMsrp;
  }
}

/**
 * Compute a list's per-row `listPrice` from a source price. For PERCENTAGE lists
 * the price is `round(base × percentage ÷ 100)`; for CUSTOMIZED lists the source
 * column is copied as-is (no calculation — the user tunes it afterwards).
 * @param base the source column value (minor units)
 * @param priceType PERCENTAGE or CUSTOMIZED
 * @param percentage 0–100 (only used for PERCENTAGE; null treated as 0)
 * @returns the computed list price in minor units
 */
export function computeListPrice(
  base: number,
  priceType: ListPriceType,
  percentage: number | null,
): number {
  if (priceType === 'PERCENTAGE') {
    return Math.round((base * (percentage ?? 0)) / 100);
  }
  return base;
}
