import { Prisma, SampleStatus } from '@prisma/client';
import {
  LabReportNotFoundException,
  LabReportSentOutException,
} from '../exceptions/lab-report.exceptions';

/**
 * The slice of a Prisma client (or transaction client) these helpers need — so
 * they work with both `PrismaService` and a `withTenant` transaction.
 */
type SentOutDb = Pick<
  Prisma.TransactionClient,
  'labReport' | 'orderSampleTest'
>;

/** The report fields the "sent out" rule reads. */
export interface SentOutReportKey {
  branchId: string | null;
  orderItemId: string;
  memberBranchLabTestId: string | null;
  labTestId: string | null;
}

/**
 * "Sent out" rule (internal branch transfer): a lab report stays visible to the
 * branch that currently holds it but is VIEW-ONLY (see
 * {@link assertReportNotSentOut}) while THAT branch's own live sample for the
 * report's test is `SENT_INTERNAL`. Between Send and Accept the report is still
 * at the sender; the lock keeps it untouched so it can move, or come back, whole.
 *
 * Only the report holder's own sample counts. After a transfer an order item has
 * two samples (the sender's `SENT_INTERNAL` original and the receiver's
 * `ACCEPTED` copy); the receiver's report must not be hidden by the sender's
 * sample, so the sample's `branchId` must equal the branch holding the report.
 * Once the receiver accepts, the report moves to the receiver's branch and the
 * sender's `SENT_INTERNAL` sample no longer matches it.
 *
 * A panel item yields one report per member test, each served by its own sample
 * (`OrderSampleTest.labTestId` = the report's `labTestId`), so a member report is
 * matched on `labTestId` — sending one member's sample must not hide its sibling
 * members. A non-panel (or grandfathered panel) report has
 * `memberBranchLabTestId = null` and is matched on the order item alone.
 *
 * Only `SENT_INTERNAL` counts — `FORWARD_EXTERNAL` / `OUTSOURCED` samples stay
 * reportable by the sending branch.
 */
export async function isReportSentOut(
  db: SentOutDb,
  tenantId: string,
  report: SentOutReportKey,
): Promise<boolean> {
  if (!report.branchId) return false;
  const link = await db.orderSampleTest.findFirst({
    where: {
      tenantId,
      orderItemId: report.orderItemId,
      deletedAt: null,
      ...(report.memberBranchLabTestId ? { labTestId: report.labTestId } : {}),
      sample: {
        is: {
          tenantId,
          branchId: report.branchId,
          status: SampleStatus.SENT_INTERNAL,
          deletedAt: null,
        },
      },
    },
    select: { id: true },
  });
  return link !== null;
}

/**
 * Write-lock: throw {@link LabReportSentOutException} when the report is sent out
 * (see {@link isReportSentOut}). A sent-out report stays VISIBLE to its holder but
 * is view-only until the transfer is received or returned, so every write path
 * calls this; reads must not. A missing report is still a plain not-found.
 * Looks the report up by id (tenant-scoped), so it can be called from any
 * service that has already resolved the caller's branch.
 * @throws LabReportNotFoundException if the report is missing
 * @throws LabReportSentOutException if the report is sent out
 */
export async function assertReportNotSentOut(
  db: SentOutDb,
  tenantId: string,
  reportId: string,
): Promise<void> {
  const report = await db.labReport.findFirst({
    where: { id: reportId, tenantId, deletedAt: null },
    select: {
      branchId: true,
      orderItemId: true,
      memberBranchLabTestId: true,
      labTestId: true,
    },
  });
  if (!report) throw new LabReportNotFoundException(reportId);
  if (await isReportSentOut(db, tenantId, report)) {
    throw new LabReportSentOutException(reportId);
  }
}

/**
 * Ids of the branch's lab reports that are currently sent out — used to mark
 * those rows view-only in list responses. Two bounded queries: (1) the sent-out
 * sample links at this branch whose order item still has a report at this branch
 * (a report that already moved to the receiving branch is excluded up front, so
 * the set stays small — only reports in the send→accept window), then (2) those
 * reports, matched per the panel-member rule in {@link isReportSentOut}.
 */
export async function findSentOutReportIds(
  db: SentOutDb,
  tenantId: string,
  branchId: string,
): Promise<string[]> {
  const links = await db.orderSampleTest.findMany({
    where: {
      tenantId,
      deletedAt: null,
      sample: {
        is: {
          tenantId,
          branchId,
          status: SampleStatus.SENT_INTERNAL,
          deletedAt: null,
        },
      },
      orderItem: {
        labReports: { some: { tenantId, branchId, deletedAt: null } },
      },
    },
    select: { orderItemId: true, labTestId: true },
  });
  if (links.length === 0) return [];

  const testsByItem = new Map<string, Set<string | null>>();
  for (const link of links) {
    const set = testsByItem.get(link.orderItemId) ?? new Set<string | null>();
    set.add(link.labTestId);
    testsByItem.set(link.orderItemId, set);
  }

  const reports = await db.labReport.findMany({
    where: {
      tenantId,
      branchId,
      deletedAt: null,
      orderItemId: { in: [...testsByItem.keys()] },
    },
    select: {
      id: true,
      orderItemId: true,
      memberBranchLabTestId: true,
      labTestId: true,
    },
  });

  return reports
    .filter((r) => {
      const sentTests = testsByItem.get(r.orderItemId);
      if (!sentTests) return false;
      return r.memberBranchLabTestId
        ? sentTests.has(r.labTestId)
        : sentTests.size > 0;
    })
    .map((r) => r.id);
}
