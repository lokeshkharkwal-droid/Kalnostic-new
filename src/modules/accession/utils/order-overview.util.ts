import type { LabReportStatus } from '@prisma/client';

/** The columns of a lab report the Order Overview needs. */
export interface OverviewReportRef {
  id: string;
  status: LabReportStatus;
  /** The branch that HOLDS the report right now (a report is held by one branch at a time). */
  branchId: string | null;
  orderItemId: string;
  /** The test the report is for; with `memberBranchLabTestId` it tells a panel member's report apart. */
  labTestId: string | null;
  /** Set for a panel member's own report; null for a whole-test (or grandfathered panel) report. */
  memberBranchLabTestId: string | null;
}

/** What links a sample to the order line + test it carries. */
export interface SampleTestLink {
  orderItemId: string;
  labTestId: string | null;
}

/**
 * The report of one sample. A report belongs to an order line (a whole test) or, for a panel, to one
 * member test of it; the sample of that member must match ITS OWN report - the same rule the report
 * status filter uses. Branch-agnostic on purpose: a sample the branch SENT keeps showing the report's
 * progress even though the receiving branch now holds it. In the (unexpected) case of several
 * matches, the one held at `branchId` wins, so the notes anchor stays at the viewer's branch.
 * @returns the report, or null when none exists yet (nothing accepted: a report is made at first Accept)
 */
export function reportForSample(
  links: readonly SampleTestLink[],
  reports: readonly OverviewReportRef[],
  branchId: string | null,
): OverviewReportRef | null {
  const matches = reports.filter((r) =>
    links.some(
      (l) =>
        l.orderItemId === r.orderItemId &&
        (r.memberBranchLabTestId === null ||
          r.labTestId === null ||
          r.labTestId === l.labTestId),
    ),
  );
  if (matches.length === 0) return null;
  return matches.find((r) => r.branchId === branchId) ?? matches[0]!;
}

/**
 * The report that notes hang on: the first report of the order held at THIS branch (notes are read
 * and written through a report the branch holds, and cover the whole order from there). Null when
 * the branch holds none - nothing accepted here yet, or every test sent away.
 * @param reports the order's reports, oldest first
 */
export function pickNotesAnchor(
  reports: readonly OverviewReportRef[],
  branchId: string | null,
): string | null {
  if (!branchId) return null;
  return reports.find((r) => r.branchId === branchId)?.id ?? null;
}

/**
 * Where a sent sample is NOW: follow the chain of copies (sent to B, accepted -> B's copy; B sent it
 * on to C, accepted -> C's copy ...) to the last one. Null when the sample has no copy (it is still
 * with this branch, or the transfer is not accepted yet). Stops after `maxHops`, and on a cycle.
 * @param cloneOf sample id -> the id of the copy its accepted INTERNAL transfer produced
 */
export function followCloneChain(
  start: string,
  cloneOf: ReadonlyMap<string, string>,
  maxHops = 6,
): string | null {
  let current = start;
  const seen = new Set<string>([start]);
  for (let i = 0; i < maxHops; i++) {
    const next = cloneOf.get(current);
    if (!next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current === start ? null : current;
}
