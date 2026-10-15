import { ResultValueSource } from '@prisma/client';

/** The stored `LabReportResultValue` fields the save decision looks at. */
export interface StoredResultValue {
  source: ResultValueSource;
  observed1: string | null;
  observed2: string | null;
  unit?: string | null;
  referenceRangeId?: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The incoming fields of one value in `PATCH /lab-reports/:id/results`. */
export interface IncomingResultValue {
  observed1?: string;
  observed2?: string;
  unit?: string;
  referenceRangeId?: string;
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
 *  - `overwrite-analyzer`: the technician changed an analyzer's value (or confirmed changing
 *    it): the new value is stored, but the row stays the analyzer's (source, analyzer id and
 *    time untouched) and the change (who, when, old value, new value) is recorded in the
 *    report's history.
 */
export type ResultValueSaveMode =
  | 'as-entered'
  | 'keep-analyzer'
  | 'overwrite-analyzer';

const text = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * The Audit Trail text for one analyzer value a technician edited, e.g.
 * `Value edited — Hemoglobin: 130 g/L → 13.5 g/dL (analyzer: Cobas)`. Who edited it and when
 * come from the history entry itself. Says so when the number itself is unchanged (only the
 * range or unit was edited).
 *
 * @param parameterName the parameter's display name
 * @param analyzerName the analyzer the value belongs to, when known
 * @param stored the value as it was stored before this edit
 * @param incoming what the technician is saving (a field left out keeps its stored value)
 * @param analyzerSentAt when the analyzer sent the value, already formatted for people (left out when unknown)
 */
export function describeAnalyzerOverwrite(
  parameterName: string,
  analyzerName: string | undefined,
  stored: Pick<StoredResultValue, 'observed1' | 'observed2'> & {
    unit?: string | null;
  },
  incoming: IncomingResultValue & { unit?: string },
  analyzerSentAt?: string,
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
    `Value edited — ${parameterName}: ` +
    `${show(stored.observed1, stored.observed2, stored.unit)} → ` +
    `${show(newO1, newO2, incoming.unit ?? stored.unit)} ` +
    `(analyzer: ${analyzerName ?? 'unknown'}` +
    `${analyzerSentAt ? `, sent ${analyzerSentAt}` : ''})` +
    (unchanged ? ' (value unchanged; range or unit edited)' : '')
  );
}

/**
 * A moment written for people in the lab's own time zone, e.g. `15 Oct 2026, 01:21 pm`. Falls back
 * to the ISO text (UTC) when the time zone name is not one the runtime knows.
 *
 * @param at the moment to write
 * @param timezone the lab's IANA time zone, e.g. `Asia/Kolkata`
 */
export function formatMomentForAudit(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

/**
 * Decide how one incoming value is saved, given the value already stored for the same
 * report and parameter.
 *
 * "Changed" compares Observed 1 and Observed 2 (trimmed; null equals ""). The unit alone is
 * deliberately NOT an edit when the analyzer sent none: the screen may fill the unit in from
 * the chosen range while the analyzer's number is untouched. A field the client did not send
 * (`undefined`) is "not touched", the same as the database upsert treats it.
 *
 * The confirmation flag (`overridesAnalyzer`) on its own is not an edit either: it makes the
 * save an edit only when the Range or an existing unit really differs from what is stored. So
 * sending the same confirmed edit again (a retry, a double click) writes no second history
 * entry.
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
  const rangeChanged =
    incoming.referenceRangeId !== undefined &&
    text(incoming.referenceRangeId) !== text(stored.referenceRangeId);
  const unitChanged =
    incoming.unit !== undefined &&
    text(stored.unit) !== '' &&
    text(incoming.unit) !== text(stored.unit);
  const confirmedChange =
    incoming.overridesAnalyzer === true && (rangeChanged || unitChanged);
  return {
    mode: changed || confirmedChange ? 'overwrite-analyzer' : 'keep-analyzer',
    stale,
  };
}
