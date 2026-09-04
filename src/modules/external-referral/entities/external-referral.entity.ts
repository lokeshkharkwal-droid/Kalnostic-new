import {
  ExternalReferral,
  ExternalReferralStatus,
  Prisma,
} from '@prisma/client';
import { LabListRef } from '../../referral-list/entities/referral-list.entity';

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
 * The GET-single response shape: the external referral plus the active branch's Lab
 * Test / Lab Panel List assignment (`branchLabTestListId`/`branchLabPanelListId`),
 * both null when there is no branch context or no assignment. The assigned lists are
 * a per-branch `ReferralListAssignment`, attached by the service.
 */
export type ExternalReferralDetail = ExternalReferral & {
  branchLabTestListId?: string | null;
  branchLabPanelListId?: string | null;
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
  country: true,
  city: true,
  isCommissionApplicable: true,
  commissionType: true,
  tds: true,
  paymentCycle: true,
  status: true,
} satisfies Prisma.ExternalReferralSelect;

/** The raw row shape returned by `EXTERNAL_REFERRAL_LIST_SELECT`. */
export type ExternalReferralListRow = Prisma.ExternalReferralGetPayload<{
  select: typeof EXTERNAL_REFERRAL_LIST_SELECT;
}>;

/**
 * The list endpoint response: the selected columns for one external referral,
 * plus the active branch's assigned Lab Test List / Lab Panel List, bulk-resolved
 * by `ReferralListAssignmentService.getAssignmentsWithListNames` (never per-row).
 */
export type ExternalReferralListItem = ExternalReferralListRow & {
  labTestList: LabListRef | null;
  labPanelList: LabListRef | null;
};

/** Re-export for convenience at call sites. */
export type { ExternalReferralStatus };
