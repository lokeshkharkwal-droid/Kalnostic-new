import { BillingType, Gender, LabReportStatus, PaymentStatus, Prisma, SampleStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AGE_TYPE_SUFFIX, fullName } from './lab-report.entity';

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

/**
 * The flat report/order context shared by every worklist row (Order, Branch
 * n/a here — these worklists don't batch-resolve Branch/Department the way
 * the main worklist does — Patient, Ref By, Ref Panel, Test/Panel/Direct),
 * mirroring `toWorklistRow`'s shaping in `lab-report.entity.ts` so the
 * frontend gets the same clean shape from every worklist endpoint instead of
 * raw Prisma nested objects (`patient.firstName`/`middleName`/`lastName`,
 * unformatted `age`/`ageType`, etc).
 */
export interface WorklistReportContext {
  id: string;
  status: LabReportStatus;
  isUrgent: boolean;

  /** Internal-only, needed to key the batched sample-status lookup below —
   * not itself a spec-required column. */
  orderItemId: string;

  /** Resolved by `attachWorklistBranchNames` — null until attached. */
  branchId: string | null;
  branch: { id: string; name: string } | null;

  /** Resolved by `attachWorklistSampleStatuses` — one entry per distinct
   * linked Accession sample; empty until attached. */
  sampleIds: string[];
  sampleStatuses: SampleStatus[];

  order: {
    id: string;
    orderCode: string;
    orderDate: Date;
    orderTime: string | null;
    billingType: BillingType;
    paymentStatus: PaymentStatus;
  } | null;
  patient: {
    id: string;
    name: string;
    age: number | null;
    ageDisplay: string | null;
    gender: Gender | null;
    umId: string | null;
    mobile: string | null;
  } | null;
  referredByDoctor: { id: string; name: string } | null;
  referralPanel: { id: string; name: string } | null;
  test: {
    id: string;
    name: string;
    kind: 'TEST' | 'PANEL' | 'DIRECT';
  } | null;
}

/** Shapes any of the 5 worklists' shared `{ labReport: ... }` include into the
 * flat `WorklistReportContext` — pure reshaping, no new queries. */
/** Shapes `ScheduledTest.assignedTo` (a `Person`) into the flat `{id, name}`
 * every other worklist actor reference uses. */
export function toAssignedTo(
  assignedTo: ScheduledTestRow['assignedTo'],
): { id: string; name: string } | null {
  return assignedTo
    ? { id: assignedTo.id, name: fullName([assignedTo.firstName, assignedTo.middleName, assignedTo.lastName]) }
    : null;
}

export function toWorklistReportContext(
  labReport: ReRunRequestRow['labReport'],
): WorklistReportContext {
  const order = labReport.orderItem?.order ?? null;
  const patient = order?.patient ?? null;
  const referredByDoctor = order?.referredByDoctor ?? null;
  const referralPanel = order?.referralPanel ?? null;
  const branchLabTest = labReport.orderItem?.branchLabTest ?? null;
  const branchLabPanel = labReport.orderItem?.branchLabPanel ?? null;

  return {
    id: labReport.id,
    status: labReport.status,
    isUrgent: labReport.isUrgent,

    orderItemId: labReport.orderItemId,

    branchId: labReport.branchId,
    branch: null,

    sampleIds: [],
    sampleStatuses: [],

    order: order
      ? {
          id: order.id,
          orderCode: order.orderCode,
          orderDate: order.orderDate,
          orderTime: order.orderTime,
          billingType: order.billingType,
          paymentStatus: order.paymentStatus,
        }
      : null,

    patient: patient
      ? {
          id: patient.id,
          name: fullName([patient.firstName, patient.middleName, patient.lastName]),
          age: patient.age,
          ageDisplay:
            patient.age != null
              ? `${patient.age}${AGE_TYPE_SUFFIX[patient.ageType ?? 'YEARS']}`
              : null,
          gender: patient.gender,
          umId: patient.umId,
          mobile: patient.mobile,
        }
      : null,

    referredByDoctor: referredByDoctor
      ? {
          id: referredByDoctor.id,
          name: fullName([
            referredByDoctor.firstName,
            referredByDoctor.middleName,
            referredByDoctor.lastName,
          ]),
        }
      : null,

    referralPanel: referralPanel
      ? { id: referralPanel.id, name: referralPanel.name }
      : null,

    test: branchLabTest
      ? { id: branchLabTest.id, name: branchLabTest.testName, kind: 'TEST' }
      : branchLabPanel
        ? { id: branchLabPanel.id, name: branchLabPanel.panelName, kind: 'PANEL' }
        : labReport.orderItem?.direct
          ? { id: labReport.orderItem.id, name: labReport.orderItem.direct, kind: 'DIRECT' }
          : null,
  };
}

/**
 * Resolves the Branch column (LABORATORY.docx §8.1-8.5) for any of the 5
 * special worklists, one batched lookup per page — mirrors
 * `LabReportService.attachBranchNames` exactly, kept here as a free function
 * (rather than duplicated per service, or requiring each of the 5 services to
 * inject LabReportService) since all 5 share the same `WorklistReportContext`
 * shape and the same `branchId` resolution need.
 */
export async function attachWorklistBranchNames<T extends WorklistReportContext>(
  prisma: PrismaService,
  tenantId: string,
  rows: T[],
): Promise<T[]> {
  const branchIds = [...new Set(rows.map((r) => r.branchId).filter((id): id is string => id !== null))];
  if (branchIds.length === 0) return rows;

  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds }, tenantId, deletedAt: null },
    select: { id: true, name: true },
  });
  const nameById = new Map(branches.map((b) => [b.id, b.name]));

  return rows.map((row) => ({
    ...row,
    branch: row.branchId && nameById.has(row.branchId)
      ? { id: row.branchId, name: nameById.get(row.branchId)! }
      : null,
  }));
}

/**
 * Resolves the Sample Status column (LABORATORY.docx §8.1-8.5) for any of the
 * 5 special worklists — mirrors `LabReportService.attachSampleStatuses`
 * exactly (same one-batched-query-per-page shape, same orderItemId keying,
 * same dedup-by-(sampleId,status) rationale — an order item can be linked to
 * more than one Accession sample).
 */
export async function attachWorklistSampleStatuses<T extends WorklistReportContext>(
  prisma: PrismaService,
  tenantId: string,
  rows: T[],
): Promise<T[]> {
  const orderItemIds = [...new Set(rows.map((r) => r.orderItemId))];
  if (orderItemIds.length === 0) return rows;

  const sampleTests = await prisma.accessionSampleTest.findMany({
    where: { orderItemId: { in: orderItemIds }, tenantId, deletedAt: null },
    select: { orderItemId: true, sample: { select: { id: true, status: true } } },
  });

  const samplesByOrderItem = new Map<string, Map<string, SampleStatus>>();
  for (const { orderItemId, sample } of sampleTests) {
    const bySampleId = samplesByOrderItem.get(orderItemId) ?? new Map<string, SampleStatus>();
    bySampleId.set(sample.id, sample.status);
    samplesByOrderItem.set(orderItemId, bySampleId);
  }

  return rows.map((row) => {
    const bySampleId = samplesByOrderItem.get(row.orderItemId);
    const entries = bySampleId ? [...bySampleId.entries()] : [];
    return {
      ...row,
      sampleIds: entries.map(([sampleId]) => sampleId),
      sampleStatuses: entries.map(([, status]) => status),
    };
  });
}

/**
 * Resolves a raw actor-id field (e.g. `ReRunRequest.requestedBy`) into a
 * human name, one batched lookup per page — same "logical ref to Person.id,
 * no Prisma relation" pattern as `LabReportService.enrichActorNames` (an
 * actor reference must survive independent of the referenced person, so it
 * stays unenforced rather than risking a cascade/restrict on Person changes).
 * Person is soft-deleted only (never hard-deleted); a missing lookup falls
 * back to the raw id rather than being silently blanked, so a caller never
 * loses the only reference they had.
 */
export async function resolveActorNames(
  prisma: PrismaService,
  actorIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => Boolean(id)))];
  const nameById = new Map<string, string>();
  if (ids.length === 0) return nameById;

  const persons = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, middleName: true, lastName: true },
  });
  for (const p of persons) {
    nameById.set(p.id, fullName([p.firstName, p.middleName, p.lastName]));
  }
  return nameById;
}
