import { ReferralPanel } from '@prisma/client';

/**
 * One slab-based commission row as stored in `ReferralPanel.commissionSlabs`
 * (JSON). Declared as a `type` (not an interface) so it carries an implicit index
 * signature and is assignable to Prisma's `InputJsonValue` on writes.
 */
export type CommissionSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  commissionPct: number;
};

/** One incentive-bonus row as stored in `ReferralPanel.bonusSlabs` (JSON). */
export type BonusSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  bonusPct: number;
};

/**
 * Domain/response shape for a referral panel. (The Prisma model is the DB source
 * of truth; `commissionSlabs`/`bonusSlabs` are JSON columns holding
 * `CommissionSlab[]` / `BonusSlab[]`.) The `branchLabTestListId` /
 * `branchLabPanelListId` are attached from the active branch's
 * `ReferralListAssignment` (not columns on the panel row) — null when no list is
 * assigned or no branch context was supplied.
 */
export type ReferralPanelEntity = ReferralPanel & {
  branchLabTestListId?: string | null;
  branchLabPanelListId?: string | null;
};

/**
 * The list endpoint response shape for a referral panel: the plain panel row (the
 * per-branch list assignment is prefilled only on the single-item GET).
 */
export type ReferralPanelListItem = ReferralPanel;
