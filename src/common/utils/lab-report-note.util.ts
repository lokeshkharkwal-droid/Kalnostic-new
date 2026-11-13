import { LabReportNoteCategory, Prisma } from '@prisma/client';

/**
 * Shared reads over the Technician Reporting notes (`LabReportNote`, written by
 * `POST /lab-reports/:id/notes` from the Order / Sample / Tech Notes dialogs).
 *
 * The Technician screen (`LabReportService`) and the Order Console
 * (`OrderService`) both show these notes, so the "which notes count" rule and
 * the per-note test/sample label live here, once. That keeps a row's note count
 * equal to the length of the note list its hover card loads.
 */

/** The three user-facing note categories (Order / Sample / Tech Notes). The other
 * `LabReportNoteCategory` values (LOCK, DELTA, RE_RUN, …) are workflow reasons,
 * not notes, and never show in these lists. */
export const PLAIN_LAB_REPORT_NOTE_CATEGORIES = [
  LabReportNoteCategory.ORDER,
  LabReportNoteCategory.SAMPLE,
  LabReportNoteCategory.TECH,
] as const;

export type PlainLabReportNoteCategory =
  (typeof PLAIN_LAB_REPORT_NOTE_CATEGORIES)[number];

/** Per-category note counts for one order (Order Console) or one worklist row. */
export interface NoteCounts {
  ORDER: number;
  SAMPLE: number;
  TECH: number;
}

/** A fresh all-zero {@link NoteCounts}. */
export function emptyNoteCounts(): NoteCounts {
  return { ORDER: 0, SAMPLE: 0, TECH: 0 };
}

/**
 * Live Order / Sample / Tech notes on any live report of the given orders. Same
 * filters as `LabReportService.findNotes` (soft-deleted notes, e.g. Tech notes
 * cleared by a Repeat, are left out), but across every branch: callers that must
 * stay in one branch narrow it themselves.
 * @param tenantId tenant scope
 * @param orderIds the orders whose reports' notes are wanted
 * @param category one category, or all three when omitted
 */
export function labReportNotesForOrdersWhere(
  tenantId: string,
  orderIds: string[],
  category?: PlainLabReportNoteCategory,
): Prisma.LabReportNoteWhereInput {
  return {
    tenantId,
    deletedAt: null,
    category: category ?? { in: [...PLAIN_LAB_REPORT_NOTE_CATEGORIES] },
    labReport: {
      tenantId,
      deletedAt: null,
      orderItem: { orderId: { in: orderIds } },
    },
  };
}

/** What a note was written against: the report's test and its sample(s). */
export interface ReportNoteLabel {
  /** The test's display name (a panel member's own test name). */
  testName: string | null;
  /** The report's sample(s) as "<sample name> · <barcode>", comma-separated;
   * null when the report has no linked sample. */
  sampleLabel: string | null;
}

/** The fields of a report that decide which of its order's samples it uses. */
export interface ReportSampleScope {
  orderItemId: string;
  labTestId: string | null;
  memberBranchLabTestId: string | null;
}

/**
 * Whether a sample-test link (`OrderSampleTest`) belongs to a report - the ONE
 * rule every note label, link and count uses, the same as the worklist's Sample
 * Status column (`LabReportService.attachSampleStatuses`): a panel-member report
 * uses only the samples of its own member test; any other report uses every
 * sample of its order item.
 */
export function sampleTestBelongsToReport(
  sampleTest: { orderItemId: string; labTestId: string | null },
  report: ReportSampleScope,
): boolean {
  if (sampleTest.orderItemId !== report.orderItemId) return false;
  const memberScoped = Boolean(
    report.memberBranchLabTestId && report.labTestId,
  );
  return !memberScoped || sampleTest.labTestId === report.labTestId;
}

/** One sample as "<sample name> · <barcode>", or whichever part exists. */
export function formatSampleLabel(
  sampleName: string | null | undefined,
  barcode: string | null | undefined,
): string | null {
  const parts = [sampleName?.trim(), barcode?.trim()].filter((p): p is string =>
    Boolean(p),
  );
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Test name + sample label for each report, in three batched queries for the
 * whole set (never one per note).
 *
 * The samples are scoped exactly like the worklist's Sample Status column
 * (`LabReportService.attachSampleStatuses`): a panel-member report gets only the
 * samples of its own member test; any other report gets every sample of its order
 * item.
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param reportIds the reports to label (duplicates are fine)
 * @returns map reportId → label; a missing report is simply absent
 */
export async function resolveReportLabels(
  db: Pick<
    Prisma.TransactionClient,
    'labReport' | 'branchLabTest' | 'orderSampleTest'
  >,
  tenantId: string,
  reportIds: string[],
): Promise<Map<string, ReportNoteLabel>> {
  const result = new Map<string, ReportNoteLabel>();
  const ids = [...new Set(reportIds)];
  if (ids.length === 0) return result;

  const reports = await db.labReport.findMany({
    where: { id: { in: ids }, tenantId },
    select: {
      id: true,
      labTestId: true,
      memberBranchLabTestId: true,
      orderItemId: true,
      orderItem: {
        select: {
          branchLabTest: { select: { testName: true } },
          branchLabPanel: { select: { panelName: true } },
        },
      },
    },
  });
  if (reports.length === 0) return result;

  const memberIds = [
    ...new Set(
      reports
        .map((r) => r.memberBranchLabTestId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [members, sampleTests] = await Promise.all([
    memberIds.length
      ? db.branchLabTest.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, testName: true },
        })
      : Promise.resolve([] as { id: string; testName: string }[]),
    db.orderSampleTest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        orderItemId: { in: [...new Set(reports.map((r) => r.orderItemId))] },
      },
      select: {
        orderItemId: true,
        labTestId: true,
        sample: { select: { sampleName: true, barcode: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.testName]));

  for (const r of reports) {
    // A Set, not a per-sample map: after an internal transfer the sender's
    // original and the receiver's copy carry the same name + barcode.
    const labels = new Set<string>();
    for (const st of sampleTests) {
      if (!sampleTestBelongsToReport(st, r)) continue;
      const label = formatSampleLabel(st.sample.sampleName, st.sample.barcode);
      if (label) labels.add(label);
    }
    const testName =
      (r.memberBranchLabTestId
        ? memberName.get(r.memberBranchLabTestId)
        : undefined) ??
      r.orderItem?.branchLabTest?.testName ??
      r.orderItem?.branchLabPanel?.panelName ??
      null;
    result.set(r.id, {
      testName,
      sampleLabel: labels.size ? [...labels].join(', ') : null,
    });
  }
  return result;
}

/**
 * The sample(s) each report was written against, by id - the same matching as
 * {@link resolveReportLabels} (see {@link sampleTestBelongsToReport}). Two
 * batched queries for the whole set. Used to show a Technician note on the
 * right sample row of the In-House list.
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param reportIds the reports to resolve (duplicates are fine)
 * @returns map reportId → its sample ids; a missing report is simply absent
 */
export async function reportSampleLinks(
  db: Pick<Prisma.TransactionClient, 'labReport' | 'orderSampleTest'>,
  tenantId: string,
  reportIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const ids = [...new Set(reportIds)];
  if (ids.length === 0) return result;

  const reports = await db.labReport.findMany({
    where: { id: { in: ids }, tenantId },
    select: {
      id: true,
      labTestId: true,
      memberBranchLabTestId: true,
      orderItemId: true,
    },
  });
  if (reports.length === 0) return result;

  const sampleTests = await db.orderSampleTest.findMany({
    where: {
      tenantId,
      deletedAt: null,
      orderItemId: { in: [...new Set(reports.map((r) => r.orderItemId))] },
    },
    select: { orderItemId: true, labTestId: true, sampleId: true },
  });
  for (const r of reports) {
    const sampleIds = new Set<string>();
    for (const st of sampleTests) {
      if (sampleTestBelongsToReport(st, r)) sampleIds.add(st.sampleId);
    }
    result.set(r.id, sampleIds);
  }
  return result;
}

/**
 * The accession sample notes: every `OrderSampleStatusHistory` row carrying a
 * note, on the orders' live samples (narrowed to one sample when given). The
 * Order Console list, its counts and the In-House per-sample counts all read
 * through this, so a count always matches its list.
 * @param tenantId tenant scope
 * @param orderIds the orders whose samples' notes are wanted
 * @param sampleId only this sample's notes, when given
 */
export function accessionSampleNotesWhere(
  tenantId: string,
  orderIds: string[],
  sampleId?: string,
): Prisma.OrderSampleStatusHistoryWhereInput {
  return {
    tenantId,
    notes: { not: null },
    deletedAt: null,
    ...(sampleId ? { sampleId } : {}),
    sample: { tenantId, orderId: { in: orderIds }, deletedAt: null },
  };
}

/** The per-sample note counts of the In-House list's Sample Status column. */
export interface SampleNoteCounts {
  SAMPLE: number;
  TECH: number;
}

/** The categories a sample row counts: its Sample Notes and Technician Notes. */
const SAMPLE_ROW_NOTE_CATEGORIES = [
  LabReportNoteCategory.SAMPLE,
  LabReportNoteCategory.TECH,
] as const;

/**
 * Sample / Tech note counts for each sample - equal, per category, to the list
 * `GET /orders/:id/notes?category=…&sampleId=…` returns
 * (`OrderService.findNotes`). Three sources, batched for the whole page:
 * - Order Overview notes (`OrderNote`): saved against the whole order (they have
 *   no sample), so each counts on EVERY sample of its order (user rule);
 * - Technician Reporting notes (`LabReportNote`): on each sample its report
 *   uses ({@link reportSampleLinks});
 * - accession notes (`OrderSampleStatusHistory.notes`): on their own sample, as
 *   Sample Notes.
 * @param db Prisma client or transaction client
 * @param tenantId tenant scope
 * @param samples the samples to count (each with its order)
 * @returns map sampleId → counts; every requested sample is present
 */
export async function noteCountsBySample(
  db: Pick<
    Prisma.TransactionClient,
    | 'orderNote'
    | 'labReportNote'
    | 'labReport'
    | 'orderSampleTest'
    | 'orderSampleStatusHistory'
  >,
  tenantId: string,
  samples: { id: string; orderId: string }[],
): Promise<Map<string, SampleNoteCounts>> {
  const result = new Map<string, SampleNoteCounts>(
    samples.map((s) => [s.id, { SAMPLE: 0, TECH: 0 }]),
  );
  if (samples.length === 0) return result;
  const orderIds = [...new Set(samples.map((s) => s.orderId))];
  const sampleIds = [...result.keys()];

  const [orderNotes, labReportNotes, accessionNotes] = await Promise.all([
    db.orderNote.groupBy({
      by: ['orderId', 'category'],
      where: {
        tenantId,
        orderId: { in: orderIds },
        category: { in: [...SAMPLE_ROW_NOTE_CATEGORIES] },
      },
      _count: { _all: true },
    }),
    db.labReportNote.findMany({
      where: {
        ...labReportNotesForOrdersWhere(tenantId, orderIds),
        category: { in: [...SAMPLE_ROW_NOTE_CATEGORIES] },
      },
      select: { category: true, labReportId: true },
    }),
    db.orderSampleStatusHistory.groupBy({
      by: ['sampleId'],
      where: {
        ...accessionSampleNotesWhere(tenantId, orderIds),
        sampleId: { in: sampleIds },
      },
      _count: { _all: true },
    }),
  ]);

  const add = (sampleId: string, category: string, n: number) => {
    const counts = result.get(sampleId);
    if (counts && category in counts) {
      counts[category as keyof SampleNoteCounts] += n;
    }
  };
  for (const g of orderNotes) {
    for (const s of samples) {
      if (s.orderId === g.orderId) add(s.id, g.category, g._count._all);
    }
  }
  if (labReportNotes.length > 0) {
    const links = await reportSampleLinks(
      db,
      tenantId,
      labReportNotes.map((n) => n.labReportId),
    );
    for (const n of labReportNotes) {
      for (const sampleId of links.get(n.labReportId) ?? []) {
        add(sampleId, n.category, 1);
      }
    }
  }
  for (const h of accessionNotes) add(h.sampleId, 'SAMPLE', h._count._all);
  return result;
}
