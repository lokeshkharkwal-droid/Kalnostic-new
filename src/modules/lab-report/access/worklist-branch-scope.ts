import {
  LabReportStatus,
  Prisma,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
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
  /**
   * True when this branch has sent samples to other branches that were accepted
   * there. The rule then also covers those reports, which now sit at another
   * branch, so the sender keeps seeing what it sent (view and print only — see
   * {@link senderLinkWhere}).
   */
  senderLinked?: boolean;
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
  /**
   * The caller's own (home / active) branch. Set only when a rule is
   * `senderLinked`. A sender-linked report sits at a branch OUTSIDE `rules`; it
   * stays workable when that branch is the caller's OWN one (see
   * {@link canWorkAtHolder}) — nothing is granted by this field, every write is
   * still judged at the report's branch with the caller's role there.
   */
  ownBranchId?: string;
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
 * Reports the branch SENT to another branch: the report is now held elsewhere,
 * and the branch's own sample for that test was accepted by the receiver through
 * an internal transfer.
 *
 * Matching goes through the order item (the same key the re-home uses), so a
 * panel is matched at item level; the report must have left the branch, which
 * keeps unsent members of a panel (still at the sender) out. The link lasts while
 * the transfer stays accepted: a Retrieve, or the receiver's Repeat / Return,
 * moves the transfer out of the accepted state and ends it, as does removing the
 * test from the order.
 */
export function senderLinkWhere(branchId: string): Prisma.LabReportWhereInput {
  return {
    branchId: { not: branchId },
    orderItem: {
      is: {
        orderSampleTests: {
          some: {
            deletedAt: null,
            sample: {
              is: {
                branchId,
                deletedAt: null,
                transfers: {
                  some: {
                    kind: TransferKind.INTERNAL,
                    transferStatus: TransferStatus.ACCEPTED,
                    branchId,
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * The reports one rule covers: those held by the branch plus, when the rule is
 * `senderLinked`, those it sent — each limited to the statuses the rule grants.
 */
export function ruleWhere(rule: BranchRule): Prisma.LabReportWhereInput {
  const own: Prisma.LabReportWhereInput = { branchId: rule.branchId };
  const where: Prisma.LabReportWhereInput = rule.senderLinked
    ? { OR: [own, senderLinkWhere(rule.branchId)] }
    : { ...own };
  if (rule.statuses !== 'ALL') {
    where.status = { in: [...rule.statuses] };
  }
  return where;
}

/**
 * Whether the caller can WORK on a listed report held by `holderBranchId`, as far
 * as the worklist is concerned (`accessMode: 'full'`):
 *  - the holder is one of the selected branches (that rule already limited the
 *    list to the statuses it grants), or
 *  - the holder is the caller's OWN branch: the report was sent by the branch
 *    selected in the dropdown and now sits at the caller's home branch, so
 *    looking at the sender's view must not take away the work they do at home.
 * Anyone else keeps the look-only view of a report their selected branch SENT —
 * including a user whose own branch is the SENDER, who works on it by selecting
 * the receiving branch (or All Branches). The write itself is judged at the
 * holder branch, with the caller's role there (`ReportBranchScopeGuard` +
 * `PermissionGuard`).
 */
export function canWorkAtHolder(
  scope: WorklistBranchScope,
  holderBranchId: string | null,
): boolean {
  if (!holderBranchId) return false;
  if (scope.rules.some((r) => r.branchId === holderBranchId)) return true;
  return scope.ownBranchId === holderBranchId;
}

/** Rules that can match anything: a branch granting no statuses contributes nothing. */
export function usableRules(scope: WorklistBranchScope): BranchRule[] {
  return scope.rules.filter((r) => r.statuses === 'ALL' || r.statuses.size > 0);
}

/**
 * `where` fragment for the special worklists (Critical Alerts, Re-run, Out of
 * Range, Delta Check, Scheduled Tests), whose rows belong to a report. A row
 * follows its REPORT — not the branch it was raised at, which goes stale when
 * the report is re-homed — and is listed under the same per-branch rule as the
 * main worklist. No usable branch matches nothing.
 */
export function worklistRowBranchWhere(scope: WorklistBranchScope): {
  OR: Array<{ labReport: { is: Prisma.LabReportWhereInput } }>;
} {
  return {
    OR: usableRules(scope).map((r) => ({ labReport: { is: ruleWhere(r) } })),
  };
}
