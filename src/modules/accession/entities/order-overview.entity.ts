import type { LabReportStatus, SampleStatus } from '@prisma/client';
import type { OrderSampleListItem } from './accession-sample.entity';

/** The report of one test: its status, and who holds it now. */
export interface OrderOverviewReport {
  id: string;
  status: LabReportStatus;
  /** True when THIS branch holds the report (so the viewer can add notes through it). */
  heldHere: boolean;
  /** The branch that holds it now; null when unknown / no branch. */
  heldAtBranchName: string | null;
}

/** Where a sample this branch sent is now: the last branch in the chain of copies, and its status there. */
export interface OrderOverviewHolder {
  branchId: string | null;
  branchName: string | null;
  status: SampleStatus;
}

/** One test of the order, as THIS branch sees it. */
export interface OrderOverviewTest {
  /** The very row the In-House list shows for this test (so its status label cannot disagree). */
  sample: OrderSampleListItem;
  testName: string;
  /** The test's department name; null when none is assigned. */
  department: string | null;
  /** The report of this test; null until a report exists (a report is made at the first Accept). */
  report: OrderOverviewReport | null;
  /** Set only when this branch sent the sample on and a copy exists elsewhere ("Currently at Branch B: Accepted"). */
  holder: OrderOverviewHolder | null;
}

/**
 * The read-only Order Overview of the In-House list: every test of the order that this branch's list
 * shows (same rows, same department visibility), with each test's report status and, for a sample
 * sent on, where it is now.
 */
export interface OrderOverview {
  orderId: string;
  orderCode: string;
  /** A cancelled order is frozen: notes can no longer be added. */
  orderCancelled: boolean;
  /**
   * The report notes are read and written through: the first report of the order held at this branch.
   * Null when this branch holds none (nothing accepted here yet, or every test sent away) - the
   * popup then says notes are not available.
   */
  notesReportId: string | null;
  tests: OrderOverviewTest[];
}
