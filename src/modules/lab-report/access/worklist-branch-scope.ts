import { LabReportStatus } from '@prisma/client';
import { PERMISSION_KEYS } from '../../permissions/constants/module-permissions.constant';

/**
 * Report statuses visible at one branch: every status (`'ALL'` — the caller's own
 * branch, and admin roles), or an explicit set derived from that branch's
 * `access_to_<status>` permissions.
 */
export type VisibleStatuses = ReadonlySet<LabReportStatus> | 'ALL';

/** One branch of a worklist scope and the statuses the caller may see there. */
export interface BranchRule {
  branchId: string;
  statuses: VisibleStatuses;
}

/**
 * The set of branches (and, per branch, statuses) a worklist request covers. A
 * single-branch request has one rule. "All Branches" has one rule per branch the
 * caller is authorised for — never the whole tenant. Permissions are kept
 * **per branch** here: each rule carries only the statuses that branch grants,
 * nothing is merged into one global permission set.
 */
export interface WorklistBranchScope {
  rules: BranchRule[];
}

/**
 * Report status → the `access_to_<status>` permission that grants working in /
 * seeing that stage at a branch (the Technician page's status tabs).
 */
export const STATUS_ACCESS_KEYS: Readonly<Record<LabReportStatus, string>> = {
  [LabReportStatus.PENDING]: PERMISSION_KEYS.LAB_ACCESS_PENDING,
  [LabReportStatus.PARTIAL_PENDING]: PERMISSION_KEYS.LAB_ACCESS_PARTIAL_PENDING,
  [LabReportStatus.SAVED]: PERMISSION_KEYS.LAB_ACCESS_SAVED,
  [LabReportStatus.VALIDATION_PENDING]:
    PERMISSION_KEYS.LAB_ACCESS_VALIDATION_PENDING,
  [LabReportStatus.RESULT_DONE]: PERMISSION_KEYS.LAB_ACCESS_RESULT_DONE,
  [LabReportStatus.APPROVED]: PERMISSION_KEYS.LAB_ACCESS_APPROVED,
  [LabReportStatus.PUBLISHED]: PERMISSION_KEYS.LAB_ACCESS_PUBLISHED,
  [LabReportStatus.ERROR_REPORTED]: PERMISSION_KEYS.LAB_ACCESS_ERROR_REPORTED,
  [LabReportStatus.RESULT_REJECTED]: PERMISSION_KEYS.LAB_ACCESS_RESULT_REJECTED,
};

/** The statuses a permission set grants access to (one branch's permissions). */
export function visibleStatusesFor(
  permissions: ReadonlySet<string>,
): Set<LabReportStatus> {
  const out = new Set<LabReportStatus>();
  for (const status of Object.values(LabReportStatus)) {
    if (permissions.has(STATUS_ACCESS_KEYS[status])) out.add(status);
  }
  return out;
}

/** True when a report in `status` is visible under `visible`. */
export function isStatusVisible(
  visible: VisibleStatuses,
  status: LabReportStatus,
): boolean {
  return visible === 'ALL' || visible.has(status);
}

/**
 * `where` fragment for the special worklists (Critical Alerts, Re-run, Out of
 * Range, Delta Check, Scheduled Tests), whose rows belong to a report. Per
 * branch, a row is listed only when its report's status is one that branch
 * grants — the same rule the main worklist applies. No usable branch matches
 * nothing.
 */
export function worklistRowBranchWhere(scope: WorklistBranchScope): {
  OR: Array<{
    branchId: string;
    labReport?: { status: { in: LabReportStatus[] } };
  }>;
} {
  const usable = scope.rules.filter(
    (r) => r.statuses === 'ALL' || r.statuses.size > 0,
  );
  return {
    OR: usable.map((r) =>
      r.statuses === 'ALL'
        ? { branchId: r.branchId }
        : {
            branchId: r.branchId,
            labReport: { status: { in: [...r.statuses] } },
          },
    ),
  };
}
