import { LabReportStatus, SampleStatus } from '@prisma/client';

/** A single `{ id, name }` dropdown option. */
export interface LabReportOption {
  id: string;
  name: string;
}

/**
 * Everything the Reporting Worklist's filter row needs (LABORATORY.docx §3.1)
 * EXCEPT Lab Test/Lab Panel, returned in one call so the frontend doesn't fire
 * several separate lookups. `sampleStatuses`/`reportStatuses` are static
 * enum-derived lists — the rest are real tenant/branch-scoped lookups. Lab
 * Test/Lab Panel are their own paginated/searchable endpoints
 * (`GET /lab-reports/lab-test-options`, `.../lab-panel-options`) since a
 * tenant can have thousands of active tests/panels across its pricing lists.
 */
export interface LabReportOptions {
  branches: LabReportOption[];
  referredByDoctors: LabReportOption[];
  referralPanels: LabReportOption[];
  departments: LabReportOption[];
  sampleStatuses: SampleStatus[];
  reportStatuses: LabReportStatus[];
}
