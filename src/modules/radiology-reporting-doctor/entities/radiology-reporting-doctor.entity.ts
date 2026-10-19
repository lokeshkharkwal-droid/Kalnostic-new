import { DoctorStatus, Prisma, Salutation } from '@prisma/client';

/**
 * Domain/response shape for a radiology reporting doctor (the Prisma model is the
 * DB source of truth). The model is FLAT — unlike `Doctor` it has no
 * qualification/experience/schedule/slot child tables — and its
 * `departmentId`/`categoryId`/`subCategoryId`/`branchId` are plain logical refs
 * (no Prisma relations), so there is nothing to `include`.
 */
export type RadiologyReportingDoctorEntity =
  Prisma.RadiologyReportingDoctorGetPayload<object>;

/**
 * A reporting doctor augmented with the linked classification names and the
 * signatory department/category/sub-category selections resolved from their stored
 * id arrays into `{ id, name }` references. The raw columns only hold ids; the
 * detail endpoint resolves the names so the frontend's chips/labels render without
 * an extra round-trip.
 */
export type RadiologyReportingDoctorDetail = RadiologyReportingDoctorEntity & {
  department: ClassificationRef | null;
  category: ClassificationRef | null;
  subCategory: ClassificationRef | null;
  signatoryDepartments: ClassificationRef[];
  signatoryCategories: ClassificationRef[];
  signatorySubCategories: ClassificationRef[];
};

/**
 * Trimmed projection backing the list endpoint. Only the columns the listing needs
 * are selected; the service reshapes these into `RadiologyReportingDoctorListItem`.
 */
export const RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT = {
  id: true,
  salutation: true,
  firstName: true,
  lastName: true,
  doctorType: true,
  registrationNo: true,
  departmentId: true,
  categoryId: true,
  subCategoryId: true,
  phone: true,
  email: true,
  status: true,
  isReportSignatory: true,
  consultationFee: true,
  followUpFee: true,
} satisfies Prisma.RadiologyReportingDoctorSelect;

/** The raw row shape returned by `RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT`. */
export type RadiologyReportingDoctorListRow =
  Prisma.RadiologyReportingDoctorGetPayload<{
    select: typeof RADIOLOGY_REPORTING_DOCTOR_LIST_SELECT;
  }>;

/** A reference to a linked department/category/sub-category (id + name). */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * The shape returned by the list endpoint. `name` is the composed full name;
 * `specialization` is the linked category name; `superSpecialization` is the
 * linked sub-category name; `contact` is the phone.
 */
export interface RadiologyReportingDoctorListItem {
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
  /** `Decimal` columns — the ResponseInterceptor serialises these to numbers. */
  consultationFee: Prisma.Decimal;
  followUpFee: Prisma.Decimal;
}
