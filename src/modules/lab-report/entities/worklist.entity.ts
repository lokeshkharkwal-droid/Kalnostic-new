import { Prisma } from '@prisma/client';

/**
 * Relations eager-loaded for every worklist list view (Re-Run, Critical Alert,
 * Out of Range, Delta Check) — the report + its order context, for the shared
 * columns (Order, Branch, Patient, Ref By, Ref Panel, Order Item, Sample
 * Status, Report Status per LABORATORY.docx §8.1-8.4).
 */
export const WORKLIST_REPORT_INCLUDE = {
  labReport: {
    include: {
      orderItem: {
        include: {
          order: {
            include: { patient: true, referredByDoctor: true, referralPanel: true },
          },
          branchLabTest: true,
          branchLabPanel: true,
        },
      },
    },
  },
} satisfies Prisma.ReRunRequestInclude;

export type ReRunRequestRow = Prisma.ReRunRequestGetPayload<{
  include: typeof WORKLIST_REPORT_INCLUDE;
}>;

/** Same include shape, retyped per model (Prisma generates a distinct Include type per model). */
export const CRITICAL_ALERT_INCLUDE = {
  labReport: WORKLIST_REPORT_INCLUDE.labReport,
} satisfies Prisma.CriticalAlertInclude;
export type CriticalAlertRow = Prisma.CriticalAlertGetPayload<{
  include: typeof CRITICAL_ALERT_INCLUDE;
}>;

export const OUT_OF_RANGE_INCLUDE = {
  labReport: WORKLIST_REPORT_INCLUDE.labReport,
} satisfies Prisma.OutOfRangeFlagInclude;
export type OutOfRangeFlagRow = Prisma.OutOfRangeFlagGetPayload<{
  include: typeof OUT_OF_RANGE_INCLUDE;
}>;

export const DELTA_CHECK_INCLUDE = {
  labReport: WORKLIST_REPORT_INCLUDE.labReport,
} satisfies Prisma.DeltaCheckInclude;
export type DeltaCheckRow = Prisma.DeltaCheckGetPayload<{
  include: typeof DELTA_CHECK_INCLUDE;
}>;

export const SCHEDULED_TEST_INCLUDE = {
  labReport: WORKLIST_REPORT_INCLUDE.labReport,
  assignedTo: true,
} satisfies Prisma.ScheduledTestInclude;
export type ScheduledTestRow = Prisma.ScheduledTestGetPayload<{
  include: typeof SCHEDULED_TEST_INCLUDE;
}>;
