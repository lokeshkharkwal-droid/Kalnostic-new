import {
  LabReportStatus,
  OrderStatus,
  Prisma,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import {
  LabReportItemRemovedException,
  LabReportNotFoundException,
  LabReportOrderCancelledException,
  LabReportSampleAwaitingException,
  LabReportSentOutException,
} from '../exceptions/lab-report.exceptions';
import { VALIDATED_REPORT_STATUSES } from './validated-report.util';

/**
 * The slice of a Prisma client (or transaction client) these helpers need — so
 * they work with both `PrismaService` and a `withTenant` transaction.
 */
type SentOutDb = Pick<
  Prisma.TransactionClient,
  'labReport' | 'orderSampleTest' | 'sampleTransfer'
>;

/**
 * Sample statuses that come BEFORE the sample is accepted for testing. A report is
 * created when a sample is first accepted, so in a first cycle none of these ever
 * has a report. After a Repeat the report already exists while the sample is back
 * in one of these (Repeat, then re-collected, held, acquired...), and nobody may
 * enter results until it is accepted again.
 */
export const PRE_ACCEPT_SAMPLE_STATUSES: SampleStatus[] = [
  SampleStatus.NEW,
  SampleStatus.COLLECTED,
  SampleStatus.ACQUIRED,
  SampleStatus.HALT,
  SampleStatus.ERROR,
  SampleStatus.HOLD,
  SampleStatus.REPEAT,
];

/**
 * Report statuses that are NOT locked while their outsourced sample is sent back ("Outsourced – Repeated"): a validated result
 * (Result Done, Approved, Published) and Error Reported. The lock keeps results from being entered on a sample that is going
 * back, but these reports have nothing to enter - the only way forward is Error Reported -> Re-run (which wipes the report and
 * closes the outsource transfer as Repeat). Locking them left a dead end: the sender's Repeat refuses a validated result ("use
 * Re-run") while the technician could not report the error or Re-run because the report was view-only. Once the Re-run has
 * wiped the report (Pending) the lock applies as before.
 */
export const OUTSOURCE_SENT_BACK_UNLOCKED_STATUSES: LabReportStatus[] = [
  ...VALIDATED_REPORT_STATUSES,
  LabReportStatus.ERROR_REPORTED,
];

/**
 * The sample statuses that keep a report locked ("awaiting its sample"): every status before Accept, and
 * CANCELLED. A sample that was Repeated for a re-collection and then cancelled leaves the report with no
 * sample behind it, so the report stays locked until the sample is brought back (Retrieve restores a
 * cancelled sample to the status it had) and accepted again, or the test is removed from the order.
 */
export const AWAITING_SAMPLE_STATUSES: SampleStatus[] = [
  ...PRE_ACCEPT_SAMPLE_STATUSES,
  SampleStatus.CANCELLED,
];

/**
 * The statuses of an OUTSOURCE transfer that mean the outside lab sent the sample back (Repeated / Rejected). The sample
 * then stays OUTSOURCED ("Outsourced – Repeated") until the sender confirms a Repeat or Retrieves it.
 */
export const OUTSOURCE_SENT_BACK_STATUSES: TransferStatus[] = [
  TransferStatus.REPEAT,
  TransferStatus.REJECTED,
];

/**
 * The OUTSOURCED samples (of the given ids) whose newest outsource transfer was sent back (Repeated / Rejected).
 * One query for all the samples.
 */
export async function findOutsourceSentBackSampleIds(
  db: Pick<Prisma.TransactionClient, 'sampleTransfer'>,
  tenantId: string,
  sampleIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(sampleIds)];
  if (unique.length === 0) return new Set();
  const transfers = await db.sampleTransfer.findMany({
    where: {
      tenantId,
      sampleId: { in: unique },
      kind: TransferKind.OUTSOURCE,
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { sampleId: true, transferStatus: true },
  });
  const seen = new Set<string>();
  const sentBack = new Set<string>();
  for (const t of transfers) {
    if (seen.has(t.sampleId)) continue; // newest first
    seen.add(t.sampleId);
    if (OUTSOURCE_SENT_BACK_STATUSES.includes(t.transferStatus)) {
      sentBack.add(t.sampleId);
    }
  }
  return sentBack;
}

/** The report fields the "sent out" rule reads. */
export interface SentOutReportKey {
  /** The report's status. Optional: without it the outsource-sent-back exemption (see
   *  {@link OUTSOURCE_SENT_BACK_UNLOCKED_STATUSES}) is not applied. */
  status?: LabReportStatus;
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
 * "Awaiting its sample" rule: the report's holder branch has live samples for the
 * report's test, and EVERY one of them is still before Accept or cancelled (see
 * {@link AWAITING_SAMPLE_STATUSES}) — a Repeat took the sample back to
 * re-collection — or is OUTSOURCED with its outsource transfer sent back
 * ("Outsourced – Repeated"). If any linked sample is already accepted (a test with two
 * containers, one of them accepted) the report is workable, exactly as in a first
 * cycle. No live linked sample at the holder branch (the sample is at another
 * branch, or old data) means the rule does not apply.
 *
 * Matching follows {@link isReportSentOut}: the holder branch's own samples, and
 * for a panel member only its own sample.
 */
export async function isReportAwaitingSample(
  db: SentOutDb,
  tenantId: string,
  report: SentOutReportKey,
): Promise<boolean> {
  return (await reportAwaitingKind(db, tenantId, report)) !== null;
}

/** Why a report is waiting for its sample: the sample is back before Accept / cancelled, or an outside lab sent it back. */
export type AwaitingKind = 'SAMPLE' | 'OUTSOURCED';

/**
 * The rule behind {@link isReportAwaitingSample}, with the reason: `'SAMPLE'` when every sample is still before Accept (or
 * cancelled), `'OUTSOURCED'` when the sample is at an outside lab that sent it back, `null` when the report is workable.
 */
export async function reportAwaitingKind(
  db: SentOutDb,
  tenantId: string,
  report: SentOutReportKey,
): Promise<AwaitingKind | null> {
  if (!report.branchId) return null;
  const links = await db.orderSampleTest.findMany({
    where: {
      tenantId,
      orderItemId: report.orderItemId,
      deletedAt: null,
      ...(report.memberBranchLabTestId ? { labTestId: report.labTestId } : {}),
      sample: {
        is: { tenantId, branchId: report.branchId, deletedAt: null },
      },
    },
    select: { sample: { select: { id: true, status: true } } },
  });
  if (links.length === 0) return null;
  if (links.every((l) => AWAITING_SAMPLE_STATUSES.includes(l.sample.status))) {
    return 'SAMPLE';
  }
  // "Outsourced – Repeated": the outside lab sent the sample back (Repeat / Reject) and the sender has not decided yet.
  // Every sample must be waiting, or outsourced and sent back; one accepted sample makes the report workable.
  // A report with a validated result (or Error Reported) is not locked: its way forward is Error Reported -> Re-run.
  if (
    report.status &&
    OUTSOURCE_SENT_BACK_UNLOCKED_STATUSES.includes(report.status)
  ) {
    return null;
  }
  const outsourced = links.filter(
    (l) => l.sample.status === SampleStatus.OUTSOURCED,
  );
  if (outsourced.length === 0) return null;
  if (
    !links.every(
      (l) =>
        AWAITING_SAMPLE_STATUSES.includes(l.sample.status) ||
        l.sample.status === SampleStatus.OUTSOURCED,
    )
  ) {
    return null;
  }
  const sentBack = await findOutsourceSentBackSampleIds(
    db,
    tenantId,
    outsourced.map((l) => l.sample.id),
  );
  return outsourced.every((l) => sentBack.has(l.sample.id))
    ? 'OUTSOURCED'
    : null;
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
 * The single write-lock every report write path calls: refuse when the report's
 * order is CANCELLED (the lab may not work on a cancelled order), then when its
 * test was REMOVED from the order (the report is kept but frozen; the removal is
 * derived from the order item's `deletedAt`), then when the report is sent out (see {@link assertReportNotSentOut}), then when its sample is
 * back on Repeat awaiting re-acceptance (see {@link isReportAwaitingSample}).
 * Reads must not call it. A missing report is still a plain not-found.
 *
 * `allowAwaitingSample` skips ONLY the last rule, for writes that are not results:
 * an Order or Sample note is exactly what someone writes while a sample waits to be
 * re-collected ("hemolysed, please recollect"). A cancelled or sent-out report
 * still refuses everything.
 * @throws LabReportOrderCancelledException if the report's order is cancelled
 * @throws LabReportItemRemovedException if the report's test was removed from the order
 * @throws LabReportNotFoundException if the report is missing
 * @throws LabReportSentOutException if the report is sent out
 * @throws LabReportSampleAwaitingException if its sample awaits re-acceptance
 */
export async function assertReportWritable(
  db: SentOutDb,
  tenantId: string,
  reportId: string,
  opts: { allowAwaitingSample?: boolean } = {},
): Promise<void> {
  const cancelled = await db.labReport.findFirst({
    where: {
      id: reportId,
      tenantId,
      deletedAt: null,
      orderItem: { order: { status: OrderStatus.CANCELLED } },
    },
    select: { id: true },
  });
  if (cancelled) throw new LabReportOrderCancelledException(reportId);
  const report = await db.labReport.findFirst({
    where: { id: reportId, tenantId, deletedAt: null },
    select: {
      status: true,
      branchId: true,
      orderItemId: true,
      memberBranchLabTestId: true,
      labTestId: true,
      orderItem: { select: { deletedAt: true } },
    },
  });
  if (!report) throw new LabReportNotFoundException(reportId);
  // The test was removed from the order: the report is kept but frozen.
  if (report.orderItem?.deletedAt) {
    throw new LabReportItemRemovedException(reportId);
  }
  if (await isReportSentOut(db, tenantId, report)) {
    throw new LabReportSentOutException(reportId);
  }
  if (!opts.allowAwaitingSample) {
    const awaiting = await reportAwaitingKind(db, tenantId, report);
    if (awaiting) {
      throw new LabReportSampleAwaitingException(
        reportId,
        awaiting === 'OUTSOURCED',
      );
    }
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
