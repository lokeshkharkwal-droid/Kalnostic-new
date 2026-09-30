import { TatUnit } from '@prisma/client';

/**
 * The four TAT (turnaround time) columns shared by `LabTest`/`LabPanel` (Master
 * Data) and their branch Lab Test/Panel List copies (`BranchLabTest`/
 * `BranchLabPanel`). The Create-Order Diagnostic Items table and the TAT engine
 * both read these from the branch copy.
 */
export interface TatConfig {
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/** Prisma `select` for exactly the {@link TatConfig} columns. */
export const TAT_SELECT = {
  tatMinValue: true,
  tatMinUnit: true,
  tatMaxValue: true,
  tatMaxUnit: true,
} as const;

/** Any row or write payload that may carry the TAT columns. */
type TatFields = {
  [K in keyof TatConfig]?: TatConfig[K] | undefined;
};

/**
 * Extract the {@link TatConfig} from a stored row carrying the TAT columns
 * (missing fields read as `null`).
 */
export function pickTat(row: TatFields): TatConfig {
  return {
    tatMinValue: row.tatMinValue ?? null,
    tatMinUnit: row.tatMinUnit ?? null,
    tatMaxValue: row.tatMaxValue ?? null,
    tatMaxUnit: row.tatMaxUnit ?? null,
  };
}

/**
 * The TAT a row will hold after a Prisma update with `changes`, using Prisma's
 * semantics: an `undefined` field leaves the column unchanged, `null` clears it.
 * (A plain spread would be wrong here — hydrated DTO instances carry every
 * declared optional field as an own `undefined` property.)
 * @param current the row's TAT before the write
 * @param changes the update payload (only its TAT fields are read)
 */
export function applyTatChanges(
  current: TatConfig,
  changes: TatFields,
): TatConfig {
  return {
    tatMinValue:
      changes.tatMinValue !== undefined
        ? changes.tatMinValue
        : current.tatMinValue,
    tatMinUnit:
      changes.tatMinUnit !== undefined
        ? changes.tatMinUnit
        : current.tatMinUnit,
    tatMaxValue:
      changes.tatMaxValue !== undefined
        ? changes.tatMaxValue
        : current.tatMaxValue,
    tatMaxUnit:
      changes.tatMaxUnit !== undefined
        ? changes.tatMaxUnit
        : current.tatMaxUnit,
  };
}

/** Whether two TAT configs are identical (values and units). */
export function isTatEqual(a: TatConfig, b: TatConfig): boolean {
  return (
    a.tatMinValue === b.tatMinValue &&
    a.tatMinUnit === b.tatMinUnit &&
    a.tatMaxValue === b.tatMaxValue &&
    a.tatMaxUnit === b.tatMaxUnit
  );
}

/**
 * Whether a TAT config was never set — both values null. Units are ignored:
 * imports/panels default the unit to HOURS even when no value is configured.
 */
export function isTatEmpty(t: TatConfig): boolean {
  return t.tatMinValue === null && t.tatMaxValue === null;
}

/**
 * Whether a branch Lab Test/Panel List copy should take its Master Data item's
 * new TAT. A copy follows Master Data unless it was customised at branch level:
 * it inherits when its TAT is empty (never configured — also heals copies that
 * went stale before TAT propagation existed) or still equals the master's
 * previous TAT (never overridden). A copy holding any other TAT is a deliberate
 * branch override and is kept. Copies already equal to the new TAT — or empty
 * while the new TAT is empty too (only the default unit differs) — need no write.
 * @param copy the branch copy's current TAT
 * @param prevMaster the Master Data item's TAT before this write
 * @param nextMaster the Master Data item's TAT after this write
 */
export function shouldInheritTat(
  copy: TatConfig,
  prevMaster: TatConfig,
  nextMaster: TatConfig,
): boolean {
  if (isTatEqual(copy, nextMaster)) return false;
  if (isTatEmpty(copy)) return !isTatEmpty(nextMaster);
  return isTatEqual(copy, prevMaster);
}
