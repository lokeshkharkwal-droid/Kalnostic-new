import { Prisma } from '@prisma/client';

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
    select: { id: true, firstName: true, lastName: true, mobile: true },
  },
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
      phlebotomist: true,
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
      radiologist: true,
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

/** Lighter `include` for listing rows: just the patient ref. */
export const ORDER_LIST_INCLUDE = {
  patient: {
    select: { id: true, firstName: true, lastName: true, mobile: true },
  },
} satisfies Prisma.OrderInclude;

/** One order row for the listing endpoint: the order + patient ref + item count. */
export type OrderListRow = Prisma.OrderGetPayload<{
  include: typeof ORDER_LIST_INCLUDE;
}> & {
  itemCount: number;
};
