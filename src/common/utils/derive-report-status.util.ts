import { LabReportStatus } from '@prisma/client';

/**
 * Order-level reporting progress, derived per-test from each item's `LabReport`.
 * Ordered `PENDING < PARTIALLY_COMPLETED < COMPLETED < APPROVED < PUBLISHED`.
 * This is the "Order Status" the Order Console renders (and can filter by).
 */
export type OrderReportStatus =
  | 'PENDING'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'APPROVED'
  | 'PUBLISHED';

/** Report statuses that count a test as having reached "Result Done". */
const REPORT_DONE_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

/** Report statuses that count a test as "Approved" (published implies approved). */
const REPORT_APPROVED_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

/**
 * Derive an order's {@link OrderReportStatus} from the reporting state of its
 * tests, counted per **report** (not per billed line/`OrderItem`). Each
 * active item now has one OR SEVERAL `LabReport`s — a non-panel/
 * grandfathered-panel item still has exactly one, but a panel item created
 * after the per-member-test breakdown shipped has one per member test.
 *
 * Counting per report (not per item) means a panel's member tests can move
 * the order into `PARTIALLY_COMPLETED` as each one individually finishes,
 * the same way separate standalone tests on a multi-item order already did —
 * previously an item only counted as "done" once EVERY one of its reports
 * was, so a partially-finished panel stayed invisible as `PENDING` right up
 * until its very last member test finished.
 *
 * A panel item's `LabReport`s are created LAZILY, one per member test, only
 * as each member's sample is individually accepted at Accession — so
 * `item.labReports.length` alone understates a panel's true size while
 * accession is still in progress (e.g. 1 of 4 members accepted+approved
 * reads as "1 of 1 done"). `panelMemberCounts` (the panel's real, current
 * member-test count, from `BranchLabPanelTest` — no Prisma relation exists
 * between `BranchLabPanel`/`BranchLabPanelTest`, batch-resolved by the
 * caller) is used instead for a panel item's expected unit count, UNLESS
 * that item carries a "grandfathered" pre-breakdown combined report
 * (`memberBranchLabTestId === null`) — current report-creation code can
 * never produce that shape for a new item, so it's a closed, historical
 * state: such an item keeps the old "whatever reports exist today is the
 * whole story" rule instead, to avoid regressing already-working legacy
 * panels into a target they can never reach.
 *
 * An item with zero reports yet (not accepted in Accession, so no `LabReport`
 * exists) still blocks `COMPLETED`/`APPROVED` — it's treated as one (or, for
 * a panel, `panelMemberCounts`-many) not-yet-done unit(s) in the denominator.
 * It contributes nothing to `doneCount`, only to the total, mirroring
 * `REPORT_DONE_STATUSES`'s all-or-nothing per-unit rule.
 *
 * - `PUBLISHED` — every report on the order is Published, and every item has
 *   at least one report.
 * - `APPROVED` — every report on the order reached Approved/Published (same
 *   item-coverage rule), but not all are Published.
 * - `COMPLETED` — every report reached Result Done (same item-coverage rule),
 *   but not all are Approved.
 * - `PARTIALLY_COMPLETED` — at least one report reached Result Done, but not
 *   every report/item has.
 * - `PENDING` — no report reached Result Done (or the order has no items/reports).
 *
 * @param items the order's active items, each with its `branchLabPanel` ref
 *   (if any) and `labReports[].status`/`memberBranchLabTestId`
 * @param panelMemberCounts each referenced panel's true, current member-test
 *   count (`branchLabPanelId` -> count), batch-resolved by the caller
 */
export function deriveReportStatus(
  items: {
    branchLabPanel: { id: string } | null;
    labReports: {
      status: LabReportStatus;
      memberBranchLabTestId: string | null;
    }[];
  }[],
  panelMemberCounts: Map<string, number>,
): OrderReportStatus {
  if (items.length === 0) return 'PENDING';
  // Total "units" expected per item: a panel item's true member-test count
  // (never less than however many reports already exist, in case the
  // panel's catalogue membership later drifted smaller), or 1 for a
  // non-panel item / a grandfathered single-combined-report panel item.
  const expectedUnits = (item: (typeof items)[number]): number => {
    const hasGrandfatheredReport = item.labReports.some(
      (r) => r.memberBranchLabTestId === null,
    );
    if (item.branchLabPanel && !hasGrandfatheredReport) {
      const panelCount = panelMemberCounts.get(item.branchLabPanel.id) ?? 0;
      return Math.max(panelCount, item.labReports.length, 1);
    }
    return Math.max(item.labReports.length, 1);
  };
  const totalUnits = items.reduce((n, item) => n + expectedUnits(item), 0);
  const reports = items.flatMap((item) => item.labReports);
  const doneCount = reports.filter((r) =>
    REPORT_DONE_STATUSES.includes(r.status),
  ).length;
  const approvedCount = reports.filter((r) =>
    REPORT_APPROVED_STATUSES.includes(r.status),
  ).length;
  const publishedCount = reports.filter(
    (r) => r.status === LabReportStatus.PUBLISHED,
  ).length;
  if (publishedCount === totalUnits) return 'PUBLISHED';
  if (approvedCount === totalUnits) return 'APPROVED';
  if (doneCount === totalUnits) return 'COMPLETED';
  if (doneCount >= 1) return 'PARTIALLY_COMPLETED';
  return 'PENDING';
}
