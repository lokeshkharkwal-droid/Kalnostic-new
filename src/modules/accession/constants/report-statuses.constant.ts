import { SampleStatus } from '@prisma/client';

/**
 * The exception statuses the Accession Report tracks (PDF §F.2 — the six report
 * type tabs / count cards). The report aggregates only these exception events; all
 * other reporting lives in the Finance/Reports module.
 */
export const REPORT_STATUSES: readonly SampleStatus[] = [
  SampleStatus.ERROR,
  SampleStatus.HALT,
  SampleStatus.HOLD,
  SampleStatus.REPEAT,
  SampleStatus.CANCELLED,
  SampleStatus.RETURNED,
];
