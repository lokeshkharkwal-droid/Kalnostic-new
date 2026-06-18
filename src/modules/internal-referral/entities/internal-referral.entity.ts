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
 * Relations eager-loaded by the GET-single endpoint: all active assigned lab
 * tests/panels.
 */
export const INTERNAL_REFERRAL_DETAIL_INCLUDE = {
  labTests: { where: { deletedAt: null } },
  labPanels: { where: { deletedAt: null } },
} satisfies Prisma.InternalReferralInclude;

/** An internal referral with all relations loaded (raw, before enrichment). */
export type InternalReferralWithRelations = Prisma.InternalReferralGetPayload<{
  include: typeof INTERNAL_REFERRAL_DETAIL_INCLUDE;
}>;

/** An assigned lab test enriched with its resolved name/code (null if deleted). */
export type InternalReferralLabTestView =
  InternalReferralWithRelations['labTests'][number] & {
    testName: string | null;
    testCode: string | null;
  };

/** An assigned lab panel enriched with its resolved name/code (null if deleted). */
export type InternalReferralLabPanelView =
  InternalReferralWithRelations['labPanels'][number] & {
    panelName: string | null;
    panelCode: string | null;
  };

/**
 * The GET-single response shape: the internal referral with its assigned lab
 * tests/panels enriched with their resolved name/code.
 */
export type InternalReferralDetail = Omit<
  InternalReferralWithRelations,
  'labTests' | 'labPanels'
> & {
  labTests: InternalReferralLabTestView[];
  labPanels: InternalReferralLabPanelView[];
};

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing needs
 * are selected; the service returns these rows directly.
 */
export const INTERNAL_REFERRAL_LIST_SELECT = {
  id: true,
  employeeId: true,
  firstName: true,
  lastName: true,
  fullName: true,
  mobileNumber: true,
  email: true,
  isCommissionApplicable: true,
  isIncludedInPayroll: true,
  status: true,
} satisfies Prisma.InternalReferralSelect;

/** The raw row shape returned by `INTERNAL_REFERRAL_LIST_SELECT`. */
export type InternalReferralListItem = Prisma.InternalReferralGetPayload<{
  select: typeof INTERNAL_REFERRAL_LIST_SELECT;
}>;

/** Re-export for convenience at call sites. */
export type { InternalReferralStatus };
