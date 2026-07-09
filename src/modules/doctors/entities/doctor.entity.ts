import { DoctorStatus, Prisma, Salutation } from '@prisma/client';

/** Domain/response shape for a doctor (the Prisma model is the DB source of truth). */
export type DoctorEntity = Prisma.DoctorGetPayload<object>;

/**
 * Relations eager-loaded by the GET-single endpoint: all active qualifications
 * and experiences, plus the doctor's branch and linked
 * department/category/sub-category (id + name only). Ordered deterministically by
 * creation time. The doctor's charges are scalar columns on the doctor row and
 * come back automatically.
 */
export const DOCTOR_DETAIL_INCLUDE = {
  qualifications: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  experiences: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  branch: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subCategory: { select: { id: true, name: true } },
} satisfies Prisma.DoctorInclude;

/** A doctor with its active qualifications, experiences, and classification names. */
export type DoctorDetail = Prisma.DoctorGetPayload<{
  include: typeof DOCTOR_DETAIL_INCLUDE;
}>;

/**
 * A {@link DoctorDetail} augmented with the signatory department/category/
 * sub-category selections resolved from their stored id arrays into `{ id, name }`
 * references. The raw `signatory*Ids` JSON columns only hold ids; the detail
 * endpoint resolves the names so the frontend's multi-select chips render without
 * an extra round-trip.
 */
export type DoctorDetailResolved = DoctorDetail & {
  signatoryDepartments: ClassificationRef[];
  signatoryCategories: ClassificationRef[];
  signatorySubCategories: ClassificationRef[];
};

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing
 * needs are selected; the service reshapes these into `DoctorListItem` so the
 * payload matches the listing spec (specialization ← category, super
 * specialization ← sub-category, contact ← phone).
 */
export const DOCTOR_LIST_SELECT = {
  id: true,
  salutation: true,
  firstName: true,
  lastName: true,
  registrationNo: true,
  phone: true,
  email: true,
  status: true,
  isReportSignatory: true,
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  subCategory: { select: { id: true, name: true } },
} satisfies Prisma.DoctorSelect;

/** The raw row shape returned by `DOCTOR_LIST_SELECT` before reshaping. */
export type DoctorListRow = Prisma.DoctorGetPayload<{
  select: typeof DOCTOR_LIST_SELECT;
}>;

/** A reference to the doctor's linked department/category (id + name). */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * The shape returned by the list endpoint (CLAUDE.md §6 listing spec). `name` is
 * the composed full name; `specialization` is the linked category's name;
 * `superSpecialization` is the free-text sub-category; `contact` is the phone.
 */
export interface DoctorListItem {
  id: string;
  name: string;
  salutation: Salutation | null;
  registrationNo: string;
  department: ClassificationRef | null;
  specialization: string | null;
  superSpecialization: string | null;
  contact: string;
  email: string | null;
  status: DoctorStatus;
  isReportSignatory: boolean;
}
