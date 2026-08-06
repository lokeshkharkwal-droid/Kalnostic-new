import { InternalReferralStatus, Prisma } from '@prisma/client';

/**
 * One slab-based commission row as stored in `InternalReferral.commissionSlabs`
 * (JSON). Declared as a `type` (not an interface) so it carries an implicit index
 * signature and is assignable to Prisma's `InputJsonValue` on writes.
 */
export type CommissionSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  commissionPct: number;
};

/** One incentive-bonus row as stored in `InternalReferral.bonusSlabs` (JSON). */
export type BonusSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  bonusPct: number;
};

/**
 * Relations eager-loaded by the GET-single endpoint: the linked department (id +
 * name). The assigned Lab Test / Lab Panel List is a per-branch
 * `ReferralListAssignment`, attached separately by the service.
 */
export const INTERNAL_REFERRAL_DETAIL_INCLUDE = {
  department: { select: { id: true, name: true } },
} satisfies Prisma.InternalReferralInclude;

/** An internal referral with all relations loaded (raw, before enrichment). */
export type InternalReferralWithRelations = Prisma.InternalReferralGetPayload<{
  include: typeof INTERNAL_REFERRAL_DETAIL_INCLUDE;
}>;

/**
 * The GET-single response shape: the internal referral plus the active branch's Lab
 * Test / Lab Panel List assignment (`branchLabTestListId`/`branchLabPanelListId`),
 * both null when there is no branch context or no assignment.
 */
export type InternalReferralDetail = InternalReferralWithRelations & {
  branchLabTestListId?: string | null;
  branchLabPanelListId?: string | null;
};

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing needs
 * are selected; the service reshapes these into `InternalReferralListItem`
 * (mirrors `EXTERNAL_REFERRAL_LIST_SELECT`).
 */
export const INTERNAL_REFERRAL_LIST_SELECT = {
  id: true,
  employeeId: true,
  firstName: true,
  lastName: true,
  fullName: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  designation: true,
  mobileNumber: true,
  email: true,
  isCommissionApplicable: true,
  commissionType: true,
  tds: true,
  paymentCycle: true,
  isIncludedInPayroll: true,
  status: true,
} satisfies Prisma.InternalReferralSelect;

/** The raw row shape returned by `INTERNAL_REFERRAL_LIST_SELECT`. */
export type InternalReferralListRow = Prisma.InternalReferralGetPayload<{
  select: typeof INTERNAL_REFERRAL_LIST_SELECT;
}>;

/** The list endpoint response: the selected columns for one internal referral. */
export type InternalReferralListItem = InternalReferralListRow;

/** Re-export for convenience at call sites. */
export type { InternalReferralStatus };
