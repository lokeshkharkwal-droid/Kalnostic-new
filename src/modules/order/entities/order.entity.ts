import {
  LabReportStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  QuotationStatus,
  RefundStatus,
} from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';

/**
 * Derive an order's {@link PaymentStatus} from its payment ledger totals — the
 * summed `netAmount` and `paidAmount` across active `PaymentDetails` rows.
 * `PAID` when nothing is owed (`net <= 0` — a fully-discounted or zero-value
 * order has nothing left to collect, regardless of `paid`), `NOT_PAID` when
 * something is owed and nothing has been paid, `PAID` once the paid amount
 * covers the net, otherwise `PARTIALLY_PAID`. Kept as a pure helper so the
 * order create and the payment-details writes agree on the stored value (and
 * the FE mapper's `deriveStatus` mirrors it — see `mapBill.ts`).
 * @param net summed net amount
 * @param paid summed paid amount
 */
export function derivePaymentStatus(net: number, paid: number): PaymentStatus {
  if (net <= 0) return PaymentStatus.PAID;
  if (paid <= 0) return PaymentStatus.NOT_PAID;
  if (paid >= net) return PaymentStatus.PAID;
  return PaymentStatus.PARTIALLY_PAID;
}

/**
 * Whether "Generate Bill" is effectively true for this order/quote — the flag
 * that decides whether the payment ledger carries real money or is zeroed and
 * forced PAID (see `OrderService.create`/`update`). Always `true` for a
 * `QUOTE`: the lean Create/Edit-Quote form has no such concept and never
 * sends this field, so a quotation's ledger must never be zeroed by an
 * omitted or stale stored value. For every other status, an explicit
 * `false` (on this request, else the previously stored value) means "no
 * bill"; omitted everywhere else defaults to `true` (bill generated).
 * @param status the order's effective status (`dto.status` on create; `dto.status ?? existing.status` on update)
 * @param dtoValue `isBillGenerated` as sent on this request, if any
 * @param existingValue the order's currently stored `isBillGenerated` (update only)
 */
export function resolveBillGenerated(
  status: OrderStatus | undefined,
  dtoValue: boolean | undefined,
  existingValue?: boolean | null,
): boolean {
  if (status === OrderStatus.QUOTE) return true;
  return dtoValue ?? existingValue ?? true;
}

/**
 * The order's **effective paid** amount (minor units) — the money the lab has
 * legitimately retained after any cancellation charge and refunds:
 * `paidSum − cancellationCharge − refundSum − refundChargeSum`. Floored at 0.
 * This is the value the billing list shows as "Paid" and the base
 * {@link derivePaymentStatus} runs against so a cancelled/refunded order's
 * status reflects reality.
 * @param p summed `paidAmount` across PAYMENT rows
 * @param cancellationCharge the order's retained cancellation fee
 * @param refundSum summed `refundAmount` across REFUND rows (returned to patient)
 * @param refundChargeSum summed `refundCharge` across REFUND rows (retained fee)
 */
export function computeEffectivePaid(
  p: number,
  cancellationCharge: number,
  refundSum: number,
  refundChargeSum: number,
): number {
  return roundToTwoDecimalPlaces(
    Math.max(0, p - cancellationCharge - refundSum - refundChargeSum),
  );
}

/**
 * Derive an order's {@link RefundStatus} from its payment ledger totals. `NONE`
 * when nothing has been refunded; otherwise `FULLY_REFUNDED` once the retained
 * (effective) paid amount has been fully returned, else `PARTIALLY_REFUNDED`.
 * Reuses {@link computeEffectivePaid} so it stays in lock-step with the stored
 * `paymentStatus` — this is what lets the UI fold the refund state into the
 * single Status label (a fully-paid-then-refunded order reads "Refunded", not
 * "Not Paid"). Recomputed wherever a refund ledger row is written.
 * @param paidSum summed `paidAmount` across PAYMENT rows
 * @param cancellationCharge the order's retained cancellation fee
 * @param refundSum summed `refundAmount` across REFUND rows (returned to patient)
 * @param refundChargeSum summed `refundCharge` across REFUND rows (retained fee)
 */
export function deriveRefundStatus(
  paidSum: number,
  cancellationCharge: number,
  refundSum: number,
  refundChargeSum: number,
): RefundStatus {
  if (refundSum <= 0) return RefundStatus.NONE;
  const effectivePaid = computeEffectivePaid(
    paidSum,
    cancellationCharge,
    refundSum,
    refundChargeSum,
  );
  return effectivePaid <= 0
    ? RefundStatus.FULLY_REFUNDED
    : RefundStatus.PARTIALLY_REFUNDED;
}

/**
 * Order-level reporting progress, derived per-test from each item's `LabReport`.
 * Ordered `PENDING < PARTIALLY_COMPLETED < COMPLETED < APPROVED`. This is the
 * "Order Status" the Order Console renders (and can filter by).
 */
export type OrderReportStatus =
  | 'PENDING'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'APPROVED';

/** Report statuses that count a test as having reached "Result Done". */
const REPORT_DONE_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

/** Report statuses that count a test as "Approved" (published implies approved). */
const REPORT_APPROVED_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

/**
 * Derive an order's {@link OrderReportStatus} from the reporting state of its
 * tests, counted per **report** (not per billed line/`OrderItem`). Each
 * active item now has one OR SEVERAL `LabReport`s — a non-panel/
 * grandfathered-panel item still has exactly one, but a panel item created
 * after the per-member-test breakdown shipped has one per member test.
 *
 * Counting per report (not per item) means a panel's member tests can move
 * the order into `PARTIALLY_COMPLETED` as each one individually finishes,
 * the same way separate standalone tests on a multi-item order already did —
 * previously an item only counted as "done" once EVERY one of its reports
 * was, so a partially-finished panel stayed invisible as `PENDING` right up
 * until its very last member test finished.
 *
 * A panel item's `LabReport`s are created LAZILY, one per member test, only
 * as each member's sample is individually accepted at Accession — so
 * `item.labReports.length` alone understates a panel's true size while
 * accession is still in progress (e.g. 1 of 4 members accepted+approved
 * reads as "1 of 1 done"). `panelMemberCounts` (the panel's real, current
 * member-test count, from `BranchLabPanelTest` — no Prisma relation exists
 * between `BranchLabPanel`/`BranchLabPanelTest`, batch-resolved by the
 * caller) is used instead for a panel item's expected unit count, UNLESS
 * that item carries a "grandfathered" pre-breakdown combined report
 * (`memberBranchLabTestId === null`) — current report-creation code can
 * never produce that shape for a new item, so it's a closed, historical
 * state: such an item keeps the old "whatever reports exist today is the
 * whole story" rule instead, to avoid regressing already-working legacy
 * panels into a target they can never reach.
 *
 * An item with zero reports yet (not accepted in Accession, so no `LabReport`
 * exists) still blocks `COMPLETED`/`APPROVED` — it's treated as one (or, for
 * a panel, `panelMemberCounts`-many) not-yet-done unit(s) in the denominator.
 * It contributes nothing to `doneCount`, only to the total, mirroring
 * `REPORT_DONE_STATUSES`'s all-or-nothing per-unit rule.
 *
 * - `APPROVED` — every report on the order reached Approved/Published, and
 *   every item has at least one report.
 * - `COMPLETED` — every report reached Result Done (same item-coverage rule),
 *   but not all are Approved.
 * - `PARTIALLY_COMPLETED` — at least one report reached Result Done, but not
 *   every report/item has.
 * - `PENDING` — no report reached Result Done (or the order has no items/reports).
 *
 * @param items the order's active items, each with its `branchLabPanel` ref
 *   (if any) and `labReports[].status`/`memberBranchLabTestId`
 * @param panelMemberCounts each referenced panel's true, current member-test
 *   count (`branchLabPanelId` -> count), batch-resolved by the caller
 */
export function deriveReportStatus(
  items: {
    branchLabPanel: { id: string } | null;
    labReports: {
      status: LabReportStatus;
      memberBranchLabTestId: string | null;
    }[];
  }[],
  panelMemberCounts: Map<string, number>,
): OrderReportStatus {
  if (items.length === 0) return 'PENDING';
  // Total "units" expected per item: a panel item's true member-test count
  // (never less than however many reports already exist, in case the
  // panel's catalogue membership later drifted smaller), or 1 for a
  // non-panel item / a grandfathered single-combined-report panel item.
  const expectedUnits = (item: (typeof items)[number]): number => {
    const hasGrandfatheredReport = item.labReports.some(
      (r) => r.memberBranchLabTestId === null,
    );
    if (item.branchLabPanel && !hasGrandfatheredReport) {
      const panelCount = panelMemberCounts.get(item.branchLabPanel.id) ?? 0;
      return Math.max(panelCount, item.labReports.length, 1);
    }
    return Math.max(item.labReports.length, 1);
  };
  const totalUnits = items.reduce((n, item) => n + expectedUnits(item), 0);
  const reports = items.flatMap((item) => item.labReports);
  const doneCount = reports.filter((r) =>
    REPORT_DONE_STATUSES.includes(r.status),
  ).length;
  const approvedCount = reports.filter((r) =>
    REPORT_APPROVED_STATUSES.includes(r.status),
  ).length;
  if (approvedCount === totalUnits) return 'APPROVED';
  if (doneCount === totalUnits) return 'COMPLETED';
  if (doneCount >= 1) return 'PARTIALLY_COMPLETED';
  return 'PENDING';
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
      salutation: true,
      mobile: true,
      gender: true,
      age: true,
      ageType: true,
      dateOfBirth: true,
      bloodGroup: true,
      email: true,
      alternateMobileNumber: true,
      alternateEmail: true,
      umId: true,
      addressLine1: true,
    },
  },
  branch: { select: { id: true, name: true, code: true } },
  referredByDoctor: {
    select: { id: true, firstName: true, lastName: true },
  },
  referralPanel: {
    select: {
      id: true,
      name: true,
      code: true,
      // Accounts-person contact — drives the `accounts_biling` document + the
      // panel recipient of the order-bill "Share and Inform" flow.
      accountsPersonName: true,
      accountsPersonEmail: true,
      accountsPersonMobile: true,
    },
  },
  internalReferral: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      // Logical ref to persons.id — the in-app (IAM) share target for an
      // internal-referral party.
      employeeId: true,
    },
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
  // The order(s) this quote was converted into — used to surface "View Order"
  // on a CONVERTED quotation. Empty for ordinary (non-quote) orders.
  convertedOrder: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderCode: true, externalOrderId: true },
  },
} satisfies Prisma.OrderInclude;

/** A fully-composed order (the get-one / create / update response shape). */
export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}> & {
  /**
   * Whether an invoice has been generated for this order — true when an active
   * (non-deleted) `InvoiceSourceOrder` link to a non-deleted invoice exists.
   * Drives the frontend "invoice-locked" restriction (an invoiced order can no
   * longer be updated or cancelled) and the backend update/cancel guards.
   * Independent of the invoice's payment status; a cancelled invoice
   * soft-deletes its links, so this returns to false.
   */
  hasInvoice: boolean;
  /** The invoice number of the active invoice linked to this order, if any. */
  invoiceCode: string | null;
};

/**
 * Aggregated Billing/Collection metrics (whole rupees) for the Finance → Reports
 * summary cards. `due` is the sum of each order's floored `net − paid`. The
 * payment-mode fields break `paid` down by mode (Collection mapping: `CASH`→cash,
 * `UPI`→upi, `BANK_TRANSFER`→bankTransfer, `CARD`→debitCard, `CREDIT`→creditCard;
 * WALLET excluded) — for a collection report `paid === cash + upi + bankTransfer
 * + debitCard + creditCard`.
 */
export interface BillingSummary {
  gross: number;
  discount: number;
  net: number;
  paid: number;
  due: number;
  tds: number;
  cash: number;
  upi: number;
  bankTransfer: number;
  debitCard: number;
  creditCard: number;
  /** Σ of REFUND ledger rows' refund amount (Refund report). */
  refundAmount: number;
  /** Σ of the orders' cancellation charges (Cancel report). */
  cancelAmount: number;
}

/**
 * One user-wise Billing aggregate row — the same totals as {@link BillingSummary}
 * grouped by the order's creator (`Order.createdBy`), plus the order count and
 * the resolved display name. `userId` is `''` for the (single) bucket of orders
 * with no recorded creator.
 */
export interface BillingSummaryByUserRow extends BillingSummary {
  userId: string;
  userName: string;
  orderCount: number;
}

/**
 * One row of a **grouped** Billing summary (`b2b` / `ref-by` / `lab-test` /
 * `lab-panel`). `id`/`name` identify the group (referral panel, referring doctor,
 * lab test, or lab panel). For the order-level dimensions (`b2b`, `ref-by`) every
 * money field is meaningful; for the item-level dimensions (`lab-test`,
 * `lab-panel`) only `gross`/`discount`/`net`/`orderCount` are — `paid`/`due`/`tds`
 * are order-level and returned as 0 (the UI disables those columns there).
 */
export interface BillingGroupRow extends BillingSummary {
  id: string;
  name: string;
  orderCount: number;
}

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
      email: true, // Share and Inform: auto-fill the Email recipient
      whatsappNumber: true, // Share and Inform: auto-fill the WhatsApp recipient
      gender: true,
      age: true,
      dateOfBirth: true,
      umId: true,
    },
  },
  branch: { select: { id: true, name: true, code: true } },
  referredByDoctor: {
    select: { id: true, firstName: true, lastName: true, mobileNumber: true },
  },
  referralPanel: {
    select: { id: true, name: true, code: true, directorMobile: true },
  },
  internalReferral: {
    select: { id: true, fullName: true, mobileNumber: true },
  },
  externalReferral: { select: { id: true, name: true, mobileNumber: true } },
  appointment: { select: { id: true, status: true, code: true } },
  items: {
    where: { deletedAt: null },
    select: {
      id: true,
      direct: true,
      branchLabTest: { select: { id: true, testName: true, testCode: true } },
      branchLabPanel: {
        select: { id: true, panelName: true, panelCode: true },
      },
      // Reporting progress of this test's report(s) — one LabReport for a
      // non-panel/grandfathered-panel item, or several (one per member test)
      // for a panel item created after the per-member-test breakdown shipped.
      // Created lazily once a linked sample is accepted; empty until then —
      // that's a "not yet reported" test. Drives the order-level `reportStatus`.
      // `memberBranchLabTestId` (null on a non-panel or grandfathered report)
      // lets `deriveReportStatus` tell those apart from a per-member report.
      labReports: {
        where: { deletedAt: null },
        select: { status: true, memberBranchLabTestId: true },
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
      id: true,
      totalAmount: true,
      orderDiscount: true,
      netAmount: true,
      paidAmount: true,
      tdsDeduction: true,
      paymentMode: true,
      entryType: true,
      refundAmount: true,
      refundCharge: true,
      reference: true,
      paymentDate: true,
      createdAt: true,
    },
  },
  // The order(s) this quote was converted into — used to surface "View Order"
  // on a CONVERTED quotation. Empty for ordinary (non-quote) orders.
  convertedOrder: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderCode: true, externalOrderId: true },
  },
} satisfies Prisma.OrderInclude;

/**
 * `include` for the Finance → Billing endpoints: the order-list display refs PLUS
 * each item's `unitPrice` / `discount` / test / panel ids, so the shared
 * financial-allocation layer can split order-level money across the test/panel
 * lines (see `OrderService.allocateOrderLines`).
 */
export const BILLING_ORDER_INCLUDE = {
  ...ORDER_LIST_INCLUDE,
  items: {
    where: { deletedAt: null },
    select: {
      id: true,
      direct: true,
      unitPrice: true,
      discount: true,
      branchLabTestId: true,
      branchLabPanelId: true,
      branchLabTest: {
        select: {
          id: true,
          testName: true,
          testCode: true,
          sourceLabTestId: true,
          departmentId: true,
          categoryId: true,
          subCategoryId: true,
        },
      },
      branchLabPanel: {
        select: {
          id: true,
          panelName: true,
          panelCode: true,
          sourceLabPanelId: true,
          departmentId: true,
          categoryId: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

/** A billing order with item prices + payments, ready for allocation. */
export type BillingOrder = Prisma.OrderGetPayload<{
  include: typeof BILLING_ORDER_INCLUDE;
}>;

/**
 * One detailed-records row for a Billing dimension: the order's display refs plus
 * the money figures **for that dimension** — order-level for `all`/`userwise`/
 * `b2b`/`ref-by`, and the sum of the order's allocated test/panel lines for
 * `lab-test`/`lab-panel`. Field names mirror {@link OrderListRow} so the frontend
 * mapper is shared.
 */
export type BillingRecordRow = BillingOrder & {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  tdsAmount: number;
  dueAmount: number;
  paidAmount: number;
  /** Collection payment-mode breakdown of the row's paid (whole rupees). */
  cash: number;
  upi: number;
  bankTransfer: number;
  debitCard: number;
  creditCard: number;
  /** Refund total (Refund report) + cancellation charge (Cancel report). */
  refundAmount: number;
  cancelAmount: number;
  /**
   * Settlement reservation info (Collection report). How much of this record's
   * collected amount is already reserved by non-rejected settlements, and the
   * remaining unsettled amount. Used to disable fully-settled records from
   * Create-Settlement selection.
   */
  settlementSettled?: number;
  settlementRemaining?: number;
  /**
   * Per-payment identity (Collection report only — the report is re-grained to one
   * row per collected payment). `paymentId` is the record's identity + the
   * settlement source; the rest describe that single receipt. Absent on the other
   * reports (which stay order-grained).
   */
  paymentId?: string;
  paymentMode?: string;
  paymentReference?: string | null;
  paymentDate?: Date | null;
};

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
  /**
   * Order-level reporting progress, derived per-test from each item's LabReport
   * ({@link deriveReportStatus}). This is the Order Console's "Order Status".
   */
  reportStatus: OrderReportStatus;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  /** Sum of `tdsDeduction` across the active payment ledger (TDS withheld). */
  tdsAmount: number;
  /** Outstanding balance for the row: `netAmount − paidAmount`, floored at 0. */
  dueAmount: number;
  /**
   * Gross sum of `paidAmount` across the active payment ledger (money collected;
   * unaffected by cancellation charges/refunds — those are reported separately so
   * every existing consumer keeps its meaning).
   */
  paidAmount: number;
  /** Sum of `refundAmount` across REFUND rows — money returned to the patient. */
  refundedAmount: number;
  /** Sum of `refundCharge` across REFUND rows — fee retained on standalone refunds. */
  refundChargeTotal: number;
  effectiveQuotationStatus: QuotationStatus | null;
  /**
   * Runtime-computed quotation expiry (Quotations screen only): the order date
   * (or `createdAt`) plus the branch's current validity window. Null on
   * non-quotation listings or when no branch/settings are resolvable.
   */
  computedQuotationExpiryAt: Date | null;
  /**
   * The order this quote was converted into (most recent active one), or null.
   * `convertedOrderCode` prefers the user-facing external id, falling back to the
   * internal order code — used to surface the "View Order" link on a CONVERTED
   * quotation row.
   */
  convertedOrderId: string | null;
  convertedOrderCode: string | null;
  /**
   * Whether an invoice has been generated for this order — true when an active
   * (non-deleted) `InvoiceSourceOrder` link to a non-deleted invoice exists.
   * Drives the frontend "invoice-locked" restriction (an invoiced order can no
   * longer be updated or cancelled), regardless of the invoice's payment status.
   * A cancelled invoice soft-deletes its links, so this returns to false.
   */
  hasInvoice: boolean;
  /** The invoice number of the active invoice linked to this order, if any. */
  invoiceCode: string | null;
};
