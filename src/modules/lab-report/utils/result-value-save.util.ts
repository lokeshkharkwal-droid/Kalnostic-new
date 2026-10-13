import { ResultValueSource } from '@prisma/client';

/** The stored `LabReportResultValue` fields the save decision looks at. */
export interface StoredResultValue {
  source: ResultValueSource;
  observed1: string | null;
  observed2: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The incoming fields of one value in `PATCH /lab-reports/:id/results`. */
export interface IncomingResultValue {
  observed1?: string;
  observed2?: string;
  overridesAnalyzer?: boolean;
  loadedUpdatedAt?: string;
}

/**
 * How one incoming value is saved:
 *  - `as-entered`: the usual technician save (a new value, a value that is already the
 *    technician's, or a previously deleted one): stored as MANUAL, entered by the technician;
 *  - `keep-analyzer`: the stored value came from an analyzer and the technician did not change
 *    it: it stays the analyzer's (source, analyzer id and time untouched); only the range,
 *    method and display text may be updated;
 *  - `overwrite-analyzer`: the technician changed an analyzer's value (or confirmed overwriting
 *    it): stored as MANUAL and recorded in the report's history.
 */
export type ResultValueSaveMode =
  | 'as-entered'
  | 'keep-analyzer'
  | 'overwrite-analyzer';

const text = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * The Audit Trail text for one analyzer value a technician overwrote, e.g.
 * `Analyzer result overwritten — Hemoglobin: 130 g/L (from Cobas) → 13.5 g/dL`.
 * Says so when the number itself is unchanged (only the range or unit was edited).
 *
 * @param parameterName the parameter's display name
 * @param analyzerName the analyzer that filled the stored value, when known
 * @param stored the analyzer's stored value
 * @param incoming what the technician is saving (a field left out keeps its stored value)
 */
export function describeAnalyzerOverwrite(
  parameterName: string,
  analyzerName: string | undefined,
  stored: Pick<StoredResultValue, 'observed1' | 'observed2'> & {
    unit?: string | null;
  },
  incoming: IncomingResultValue & { unit?: string },
): string {
  const show = (
    o1: string | null | undefined,
    o2: string | null | undefined,
    unit: string | null | undefined,
  ): string =>
    [text(o1) || '(empty)', text(o2) ? `/ ${text(o2)}` : '', text(unit)]
      .filter(Boolean)
      .join(' ');
  const newO1 = incoming.observed1 ?? stored.observed1;
  const newO2 = incoming.observed2 ?? stored.observed2;
  const unchanged =
    text(newO1) === text(stored.observed1) &&
    text(newO2) === text(stored.observed2);
  return (
    `Analyzer result overwritten — ${parameterName}: ` +
    `${show(stored.observed1, stored.observed2, stored.unit)} ` +
    `(from ${analyzerName ?? 'analyzer'}) → ` +
    `${show(newO1, newO2, incoming.unit ?? stored.unit)}` +
    (unchanged ? ' (value unchanged; range or unit edited)' : '')
  );
}

/**
 * Decide how one incoming value is saved, given the value already stored for the same
 * report and parameter.
 *
 * "Changed" compares Observed 1 and Observed 2 only (trimmed; null equals ""). The unit is
 * deliberately NOT compared: the screen may fill the unit in from the chosen range while the
 * analyzer's number is untouched. A field the client did not send (`undefined`) is "not
 * touched", the same as the database upsert treats it.
 *
 * `stale` is true when the client sent the row version it loaded (`loadedUpdatedAt`) and the
 * stored analyzer row has changed since (the analyzer re-sent a result while the screen was
 * open). Only analyzer rows are checked; without a version the check is skipped.
 *
 * @param stored the stored value for this report and parameter, if any
 * @param incoming the value the client is saving
 * @returns the save mode, and whether the screen is out of date
 */
export function classifyResultValueSave(
  stored: StoredResultValue | undefined,
  incoming: IncomingResultValue,
): { mode: ResultValueSaveMode; stale: boolean } {
  if (
    !stored ||
    stored.deletedAt !== null ||
    stored.source !== ResultValueSource.ADAPTER
  ) {
    return { mode: 'as-entered', stale: false };
  }
  const stale =
    incoming.loadedUpdatedAt !== undefined &&
    new Date(incoming.loadedUpdatedAt).getTime() !== stored.updatedAt.getTime();
  const changed =
    (incoming.observed1 !== undefined &&
      text(incoming.observed1) !== text(stored.observed1)) ||
    (incoming.observed2 !== undefined &&
      text(incoming.observed2) !== text(stored.observed2));
  return {
    mode:
      changed || incoming.overridesAnalyzer === true
        ? 'overwrite-analyzer'
        : 'keep-analyzer',
    stale,
  };
}
