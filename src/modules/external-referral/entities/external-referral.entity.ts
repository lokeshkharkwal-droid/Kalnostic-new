import { ExternalReferralStatus, Prisma } from '@prisma/client';

/**
 * One slab-based commission row as stored in `ExternalReferral.commissionSlabs`
 * (JSON). Declared as a `type` (not an interface) so it carries an implicit index
 * signature and is assignable to Prisma's `InputJsonValue` on writes.
 */
export type CommissionSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  commissionPct: number;
};

/** One incentive-bonus row as stored in `ExternalReferral.bonusSlabs` (JSON). */
export type BonusSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  bonusPct: number;
};

/**
 * Relations eager-loaded by the GET-single endpoint: all active assigned lab
 * tests/panels.
 */
export const EXTERNAL_REFERRAL_DETAIL_INCLUDE = {
  labTests: { where: { deletedAt: null } },
  labPanels: { where: { deletedAt: null } },
} satisfies Prisma.ExternalReferralInclude;

/** An external referral with all relations loaded (raw, before enrichment). */
export type ExternalReferralWithRelations = Prisma.ExternalReferralGetPayload<{
  include: typeof EXTERNAL_REFERRAL_DETAIL_INCLUDE;
}>;

/** An assigned lab test enriched with its resolved name/code (null if deleted). */
export type ExternalReferralLabTestView =
  ExternalReferralWithRelations['labTests'][number] & {
    testName: string | null;
    testCode: string | null;
  };

/** An assigned lab panel enriched with its resolved name/code (null if deleted). */
export type ExternalReferralLabPanelView =
  ExternalReferralWithRelations['labPanels'][number] & {
    panelName: string | null;
    panelCode: string | null;
  };

/**
 * The GET-single response shape: the external referral with its assigned lab
 * tests/panels enriched with their resolved name/code.
 */
export type ExternalReferralDetail = Omit<
  ExternalReferralWithRelations,
  'labTests' | 'labPanels'
> & {
  labTests: ExternalReferralLabTestView[];
  labPanels: ExternalReferralLabPanelView[];
};

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing needs
 * are selected; the service reshapes these into `ExternalReferralListItem`.
 */
export const EXTERNAL_REFERRAL_LIST_SELECT = {
  id: true,
  name: true,
  organisationName: true,
  referralCode: true,
  mobileNumber: true,
  email: true,
  city: true,
  isCommissionApplicable: true,
  commissionType: true,
  tds: true,
  paymentCycle: true,
  status: true,
} satisfies Prisma.ExternalReferralSelect;

/** A reference to an assigned lab test/panel (id + resolved name). */
export interface LabRef {
  id: string;
  name: string;
}

/** The raw row shape returned by `EXTERNAL_REFERRAL_LIST_SELECT`. */
export type ExternalReferralListRow = Prisma.ExternalReferralGetPayload<{
  select: typeof EXTERNAL_REFERRAL_LIST_SELECT;
}>;

/**
 * The list endpoint response: the selected columns plus the assigned lab
 * test/panel references (`[{ id, name }]`), resolved by the service.
 */
export type ExternalReferralListItem = ExternalReferralListRow & {
  labTestList: LabRef[];
  labPanelList: LabRef[];
};

/** Re-export for convenience at call sites. */
export type { ExternalReferralStatus };
