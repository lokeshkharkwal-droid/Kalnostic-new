import { PaymentStatus, Prisma, QuotationStatus } from '@prisma/client';

/**
 * Derive an order's {@link PaymentStatus} from its payment ledger totals — the
 * summed `netAmount` and `paidAmount` across active `PaymentDetails` rows.
 * `NOT_PAID` when nothing is paid, `PAID` once the paid amount covers the net,
 * otherwise `PARTIALLY_PAID`. Kept as a pure helper so the order create and the
 * payment-details writes agree on the stored value (and the FE mapper mirrors it).
 * @param net summed net amount
 * @param paid summed paid amount
 */
export function derivePaymentStatus(net: number, paid: number): PaymentStatus {
  if (paid <= 0) return PaymentStatus.NOT_PAID;
  if (paid >= net) return PaymentStatus.PAID;
  return PaymentStatus.PARTIALLY_PAID;
}

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
      branchLabTest: {
        select: { id: true, testName: true, testCode: true, priceMsrp: true },
      },
      branchLabPanel: {
        select: { id: true, panelName: true, panelCode: true, priceMsrp: true },
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
 * referral refs (name only), the active payment ledger (amount fields only) so
 * the row can carry gross/discount/net rollups, plus the section refs (items with
 * their test/panel names, and the diagnostics / OPD / radiology sections with
 * their display refs) and the linked appointment's lifecycle status. This lets
 * the order/quotation lists AND the appointments list render every column without
 * a second fetch.
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
  appointment: { select: { id: true, status: true } },
  items: {
    where: { deletedAt: null },
    select: {
      id: true,
      direct: true,
      branchLabTest: { select: { id: true, testName: true, testCode: true } },
      branchLabPanel: {
        select: { id: true, panelName: true, panelCode: true },
      },
    },
  },
  diagnostics: {
    select: {
      id: true,
      appointmentAt: true,
      collectionAt: true,
      collectionAddress: true,
      isHomeVisit: true,
      sampleSource: true,
      visitCharges: true,
      sampleCollectionCharges: true,
      diagnosticPanel: { select: { id: true, panelName: true } },
      phlebotomist: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  opd: {
    select: {
      id: true,
      appointmentAt: true,
      consultantType: true,
      visitType: true,
      department: { select: { id: true, name: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  radiology: {
    select: {
      id: true,
      appointmentAt: true,
      radiologist: { select: { id: true, firstName: true, lastName: true } },
      radiologyTechnician: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  },
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
