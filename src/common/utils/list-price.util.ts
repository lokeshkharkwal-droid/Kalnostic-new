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

/**
 * A pricing list's stored price-derivation config. Structurally compatible with
 * the `BranchLabTestList` / `BranchLabPanelList` Prisma models, so either can be
 * passed directly where a `ListPricingConfig` is expected.
 */
export interface ListPricingConfig {
  /** The branch's default (Walk-in) list — always tracks MSRP by contract. */
  isDefault: boolean;
  priceType: ListPriceType;
  copyPriceFrom: ListPriceSource | null;
  copyPercentage: number | null;
}

/**
 * Compute the `listPrice` for a **new** row being materialized into a list
 * (import/create). Always returns a concrete price:
 * - default (Walk-in) list → MSRP;
 * - PERCENTAGE list → `round(sourceColumn × percentage ÷ 100)`;
 * - CUSTOMIZED list → the source column copied as-is (user tunes it afterwards).
 * @param row a row carrying the five source price columns (minor units)
 * @param cfg the target list's pricing config
 * @returns the list price to store (minor units)
 */
export function resolveImportListPrice(
  row: SourcePriceColumns,
  cfg: ListPricingConfig,
): number {
  if (cfg.isDefault) return row.priceMsrp;
  const base = resolveSourcePrice(row, cfg.copyPriceFrom ?? 'MSRP');
  return computeListPrice(base, cfg.priceType, cfg.copyPercentage);
}

/**
 * Decide the `listPrice` for an **existing** row being re-snapshotted from Master
 * Data (sync/update):
 * - default (Walk-in) list → recompute to MSRP (overwrite contract);
 * - PERCENTAGE list → recompute from the freshly-synced source column × stored
 *   percentage, so the formula stays live across every sync;
 * - CUSTOMIZED (non-default) list → return `null`, signalling the caller to
 *   **omit `listPrice` from the update** so the manually-configured price is
 *   preserved byte-for-byte.
 * @param row a row carrying the five source price columns (minor units)
 * @param cfg the target list's pricing config
 * @returns the recomputed list price, or `null` to leave the stored price untouched
 */
export function resolveSyncListPrice(
  row: SourcePriceColumns,
  cfg: ListPricingConfig,
): number | null {
  if (cfg.isDefault || cfg.priceType === 'PERCENTAGE') {
    const base = resolveSourcePrice(row, cfg.copyPriceFrom ?? 'MSRP');
    return computeListPrice(base, cfg.priceType, cfg.copyPercentage);
  }
  return null;
}
