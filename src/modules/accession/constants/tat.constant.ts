import { Prisma, SampleStatus } from '@prisma/client';

/**
 * Turnaround-time band for a sample (PDF §A.4 TAT filter bar). Derived from the
 * sample's age against the branch's configured thresholds — never stored. Terminal
 * samples (discarded/returned/cancelled) have no active TAT (`null`).
 */
export type TatStatus = 'WITHIN' | 'WARNING' | 'CRITICAL' | 'BREACHED';

/**
 * Absolute elapsed-minute cutoffs (ascending: warning < critical < breached)
 * used by `deriveTatStatus`/`tatCreatedAtRange`. Computed by
 * `OrderSampleService.tatThresholds()` from the branch's Accession Module
 * Settings (`Accession_MaximumTimeToAcceptSampleMinutes` minus the
 * `Accession_WarningThresholdMinutes`/`Accession_CriticalThresholdMinutes`
 * "minutes remaining" countdown the LIMS Settings doc describes them as).
 */
export interface TatThresholds {
  warningMinutes: number;
  criticalMinutes: number;
  breachedMinutes: number;
}

/** All TAT bands (for iterating the §A.4 bar). */
export const TAT_STATUSES: readonly TatStatus[] = [
  'WITHIN',
  'WARNING',
  'CRITICAL',
  'BREACHED',
];

/** Statuses that close a sample — no active TAT is computed for these. */
export const TERMINAL_SAMPLE_STATUSES: readonly SampleStatus[] = [
  SampleStatus.DISCARDED,
  SampleStatus.RETURNED,
  SampleStatus.CANCELLED,
];

const TERMINAL_STATUSES: ReadonlySet<SampleStatus> = new Set(
  TERMINAL_SAMPLE_STATUSES,
);

/**
 * Derive a sample's TAT band from how long it has been open vs the branch's
 * thresholds. Returns `null` for terminal samples (no active TAT).
 * @param createdAt when the sample entered accession
 * @param status the sample's current status
 * @param tat the branch's TAT thresholds (minutes)
 * @param nowMs current time (ms epoch) — passed in so callers batch one clock read
 */
export function deriveTatStatus(
  createdAt: Date,
  status: SampleStatus,
  tat: TatThresholds,
  nowMs: number,
): TatStatus | null {
  if (TERMINAL_STATUSES.has(status)) return null;
  const elapsedMin = (nowMs - createdAt.getTime()) / 60000;
  if (elapsedMin >= tat.breachedMinutes) return 'BREACHED';
  if (elapsedMin >= tat.criticalMinutes) return 'CRITICAL';
  if (elapsedMin >= tat.warningMinutes) return 'WARNING';
  return 'WITHIN';
}

/**
 * Translate a requested TAT band into a `createdAt` range filter, so the list
 * endpoint can filter by the derived band in the database (the band itself is not
 * stored). Terminal samples are excluded from every band by the caller.
 * @param band the requested TAT band
 * @param tat the branch's TAT thresholds (minutes)
 * @param nowMs current time (ms epoch)
 * @returns a `createdAt` range where the sample's age falls in `band`
 */
export function tatCreatedAtRange(
  band: TatStatus,
  tat: TatThresholds,
  nowMs: number,
): Prisma.DateTimeFilter {
  // age >= T  ⇔  createdAt <= now - T ; age < T  ⇔  createdAt > now - T.
  const at = (minutes: number) => new Date(nowMs - minutes * 60000);
  switch (band) {
    case 'BREACHED':
      return { lte: at(tat.breachedMinutes) };
    case 'CRITICAL':
      return { gt: at(tat.breachedMinutes), lte: at(tat.criticalMinutes) };
    case 'WARNING':
      return { gt: at(tat.criticalMinutes), lte: at(tat.warningMinutes) };
    case 'WITHIN':
      return { gt: at(tat.warningMinutes) };
  }
}
