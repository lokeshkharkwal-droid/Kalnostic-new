import {
  CommissionType,
  PaymentCycle,
  Prisma,
  ReferralDoctorStatus,
} from '@prisma/client';

/**
 * One slab-based commission row as stored in `ReferralDoctor.commissionSlabs`
 * (JSON). Declared as a `type` (not an interface) so it carries an implicit index
 * signature and is assignable to Prisma's `InputJsonValue` on writes.
 */
export type CommissionSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  commissionPct: number;
};

/** One incentive-bonus row as stored in `ReferralDoctor.bonusSlabs` (JSON). */
export type BonusSlab = {
  monthlyBusinessFrom: number;
  monthlyBusinessTo: number;
  bonusPct: number;
};

/**
 * Relations eager-loaded by the GET-single endpoint: all active qualifications,
 * experiences, and assigned lab tests/panels, plus the linked
 * department/category/sub-category (id + name only). Ordered deterministically by
 * creation time.
 */
export const REFERRAL_DOCTOR_DETAIL_INCLUDE = {
  qualifications: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  experiences: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  labTests: { where: { deletedAt: null } },
  labPanels: { where: { deletedAt: null } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subCategory: { select: { id: true, name: true } },
} satisfies Prisma.ReferralDoctorInclude;

/** A referral doctor with all relations loaded (raw, before enrichment). */
export type ReferralDoctorWithRelations = Prisma.ReferralDoctorGetPayload<{
  include: typeof REFERRAL_DOCTOR_DETAIL_INCLUDE;
}>;

/** An experience row enriched with the derived, read-only `duration` label. */
export type ReferralDoctorExperienceView =
  ReferralDoctorWithRelations['experiences'][number] & {
    duration: string | null;
  };

/** An assigned lab test enriched with its resolved name/code (null if deleted). */
export type ReferralDoctorLabTestView =
  ReferralDoctorWithRelations['labTests'][number] & {
    testName: string | null;
    testCode: string | null;
  };

/** An assigned lab panel enriched with its resolved name/code (null if deleted). */
export type ReferralDoctorLabPanelView =
  ReferralDoctorWithRelations['labPanels'][number] & {
    panelName: string | null;
    panelCode: string | null;
  };

/**
 * The GET-single response shape: the referral doctor with its children plus the
 * derived, read-only fields — `fullName` (first/middle/last joined), `age` (whole
 * years from `dateOfBirth`), and per-experience `duration`.
 */
export type ReferralDoctorDetail = Omit<
  ReferralDoctorWithRelations,
  'experiences' | 'labTests' | 'labPanels'
> & {
  fullName: string;
  age: number | null;
  experiences: ReferralDoctorExperienceView[];
  labTests: ReferralDoctorLabTestView[];
  labPanels: ReferralDoctorLabPanelView[];
};

/** A reference to a linked department/category/sub-category (id + name). */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing
 * needs are selected; the service reshapes these into `ReferralDoctorListItem`.
 */
export const REFERRAL_DOCTOR_LIST_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  mobileNumber: true,
  email: true,
  isCommissionApplicable: true,
  commissionType: true,
  tds: true,
  paymentCycle: true,
  status: true,
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subCategory: { select: { id: true, name: true } },
} satisfies Prisma.ReferralDoctorSelect;

/** The raw row shape returned by `REFERRAL_DOCTOR_LIST_SELECT` before reshaping. */
export type ReferralDoctorListRow = Prisma.ReferralDoctorGetPayload<{
  select: typeof REFERRAL_DOCTOR_LIST_SELECT;
}>;

/**
 * The shape returned by the list endpoint. `fullName` is the composed full name;
 * `specialty` is the linked category; `superSpecialty` is the linked sub-category.
 */
export interface ReferralDoctorListItem {
  id: string;
  fullName: string;
  mobileNumber: string;
  email: string | null;
  department: ClassificationRef | null;
  specialty: ClassificationRef | null;
  superSpecialty: ClassificationRef | null;
  isCommissionApplicable: boolean;
  commissionType: CommissionType | null;
  tds: number | null;
  paymentCycle: PaymentCycle;
  labTestList: ClassificationRef[];
  labPanelList: ClassificationRef[];
  status: ReferralDoctorStatus;
}
