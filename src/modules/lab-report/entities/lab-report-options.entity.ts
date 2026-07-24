import { LabReportStatus, SampleStatus } from '@prisma/client';

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
  sampleStatuses: SampleStatus[];
  reportStatuses: LabReportStatus[];
}
