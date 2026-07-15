import { Prisma, QuotationStatus } from '@prisma/client';

/**
 * Prisma `include` for a fully-composed order read: patient ref, the referral
 * refs (referral doctor / panel and internal / external referral records),
 * catalogue items (active only, with their resolved test/panel — `direct` items
 * carry their free-text value on the row), the three optional sections with
 * their resolved refs (the radiology technician is a `Person`), and the active
 * payment ledger.
 */
export const ORDER_INCLUDE = {
  patient: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      mobile: true,
      gender: true,
      age: true,
      dateOfBirth: true,
      bloodGroup: true,
      email: true,
      alternateMobileNumber: true,
      alternateEmail: true,
      umId: true,
    },
  },
  branch: { select: { id: true, name: true, code: true } },
  referredByDoctor: {
    select: { id: true, firstName: true, lastName: true },
  },
  referralPanel: { select: { id: true, name: true, code: true } },
  internalReferral: {
    select: { id: true, firstName: true, lastName: true, fullName: true },
  },
  externalReferral: { select: { id: true, name: true } },
  items: {
    where: { deletedAt: null },
    include: {
      branchLabTest: { select: { id: true, testName: true, testCode: true } },
      branchLabPanel: {
        select: { id: true, panelName: true, panelCode: true },
      },
    },
  },
  diagnostics: {
    include: {
      diagnosticPanel: { select: { id: true, panelName: true } },
      phlebotomist: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
        },
      },
    },
  },
  opd: {
    include: {
      department: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  radiology: {
    include: {
      radiologist: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          qualification: true,
        },
      },
      radiologistDepartment: { select: { id: true, name: true } },
      radiologistCategory: { select: { id: true, name: true } },
      radiologyTechnician: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          qualification: true,
        },
      },
    },
  },
  payments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

/** A fully-composed order (the get-one / create / update response shape). */
export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

/**
 * `include` for listing rows: patient ref (with age/gender for display), the
 * referral refs (name only), and the active payment ledger (amount fields only)
 * so the row can carry gross/discount/net rollups — everything the quotation and
 * order lists render without a second fetch.
 */
export const ORDER_LIST_INCLUDE = {
  patient: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      mobile: true,
      gender: true,
      age: true,
      dateOfBirth: true,
      umId: true,
    },
  },
  referredByDoctor: { select: { id: true, firstName: true, lastName: true } },
  referralPanel: { select: { id: true, name: true, code: true } },
  internalReferral: { select: { id: true, fullName: true } },
  externalReferral: { select: { id: true, name: true } },
  payments: {
    where: { deletedAt: null },
    select: {
      totalAmount: true,
      orderDiscount: true,
      netAmount: true,
      paidAmount: true,
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * One order row for the listing endpoint: the order + refs + item count, plus
 * the payment rollups (`grossAmount`/`discountAmount`/`netAmount`) and the
 * `effectiveQuotationStatus` (stored `quotationStatus` upgraded to EXPIRED when
 * `quotationValidTill` has passed).
 */
export type OrderListRow = Prisma.OrderGetPayload<{
  include: typeof ORDER_LIST_INCLUDE;
}> & {
  itemCount: number;
  /** Count of the order's active items with a `collectedAt` timestamp. */
  collectedItemCount: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  /** Sum of `paidAmount` across the active payment ledger. */
  paidAmount: number;
  effectiveQuotationStatus: QuotationStatus | null;
};
