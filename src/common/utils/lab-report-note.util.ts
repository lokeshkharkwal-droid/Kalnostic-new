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
    const memberScoped = Boolean(r.memberBranchLabTestId && r.labTestId);
    // A Set, not a per-sample map: after an internal transfer the sender's
    // original and the receiver's copy carry the same name + barcode.
    const labels = new Set<string>();
    for (const st of sampleTests) {
      if (st.orderItemId !== r.orderItemId) continue;
      if (memberScoped && st.labTestId !== r.labTestId) continue;
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
