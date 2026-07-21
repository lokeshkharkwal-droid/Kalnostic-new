import { LabReportStatus } from '@prisma/client';

/** A single `{ id, name }` dropdown option. */
export interface LabReportOption {
  id: string;
  name: string;
}

/**
 * Everything the Reporting Worklist's filter row needs (LABORATORY.docx §3.1),
 * returned in one call so the frontend doesn't fire 8 separate lookups.
 * `sampleStatuses`/`reportStatuses` are static enum-derived lists — the rest
 * are real tenant/branch-scoped lookups.
 */
export interface LabReportOptions {
  branches: LabReportOption[];
  referredByDoctors: LabReportOption[];
  referralPanels: LabReportOption[];
  departments: LabReportOption[];
  labPanels: LabReportOption[];
  labTests: LabReportOption[];
  sampleStatuses: string[];
  reportStatuses: LabReportStatus[];
}

/**
 * Sample-status values, exposed as a static list for now. This is Accession's
 * not-yet-built sample lifecycle (New/Collected/Accepted/...) — until that
 * ships, only the two states derivable from `OrderItem.collectedAt` are real.
 * Kept here (not in the enum) since it isn't backed by a Prisma enum today.
 */
export const SAMPLE_STATUS_OPTIONS = ['NOT_COLLECTED', 'COLLECTED'] as const;
