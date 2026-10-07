import { LabReportStatus } from '@prisma/client';

/** Minimal shape of an incoming order-item line on update (subset of OrderItemDto). */
export interface IncomingOrderItem {
  id?: string;
  branchLabTestId?: string;
  branchLabPanelId?: string;
  direct?: string;
  [key: string]: unknown;
}

/** The keep/add/remove partition of an update's items against the stored set. */
export interface OrderItemDiff {
  keep: Array<{ id: string; incoming: IncomingOrderItem }>;
  add: IncomingOrderItem[];
  removeIds: string[];
}

/**
 * Partition incoming update items against the order's existing live item ids,
 * keyed on stable `OrderItem.id`.
 * - keep: incoming line whose `id` matches a live item (fields may have changed).
 * - add: incoming line with no `id`, or an `id` that is not a live item.
 * - removeIds: live item ids absent from the incoming payload.
 * @param existingIds live (deletedAt null) OrderItem ids for the order
 * @param incoming the update DTO's items
 */
export function diffOrderItems(
  existingIds: string[],
  incoming: IncomingOrderItem[],
): OrderItemDiff {
  const existing = new Set(existingIds);
  const keptIds = new Set<string>();
  const keep: OrderItemDiff['keep'] = [];
  const add: IncomingOrderItem[] = [];
  for (const item of incoming) {
    if (item.id && existing.has(item.id)) {
      keep.push({ id: item.id, incoming: item });
      keptIds.add(item.id);
    } else {
      add.push(item);
    }
  }
  const removeIds = existingIds.filter((id) => !keptIds.has(id));
  return { keep, add, removeIds };
}

/**
 * Minimal shape of an incoming payment row on update — the fields the diff keys
 * on. Deliberately has NO index signature so a richer row type (the real
 * `OrderPaymentDto`) still satisfies `extends IncomingOrderPayment`, letting
 * `diffOrderPayments` be generic and preserve the caller's exact row type (a
 * `[key: string]: unknown` index signature would both erase that type and bar a
 * class/interface without one from matching the constraint).
 */
export interface IncomingOrderPayment {
  /** Existing PaymentDetails id — sent for rows hydrated from the order on edit. */
  id?: string;
  paidAmount?: number;
}

/** The keep/add partition of an update's payments against the stored PAYMENT set. */
export interface OrderPaymentDiff<
  T extends IncomingOrderPayment = IncomingOrderPayment,
> {
  keep: Array<{ id: string; incoming: T }>;
  add: T[];
}

/**
 * Partition incoming update payments against the order's existing live PAYMENT
 * row ids, keyed on stable `PaymentDetails.id`. Payments are **immutable
 * historical records**, so there is deliberately NO `remove` partition — a
 * collected payment is never deleted on an order edit (money is only ever
 * returned by appending a REFUND row via cancel/refund). The caller refreshes the
 * order financial snapshot on the canonical (oldest) kept row in place and
 * appends the `add` rows; existing rows keep their id / collectedBy / paymentDate
 * / reference / amount so collection history never changes after an edit.
 * - keep: incoming row whose `id` matches a live PAYMENT row (preserve it).
 * - add: incoming row with no `id`, or an `id` that is not a live PAYMENT row —
 *   a genuinely new collection to append.
 * @param existingIds live (deletedAt null) PAYMENT row ids for the order
 * @param incoming the update DTO's payment rows
 */
export function diffOrderPayments<T extends IncomingOrderPayment>(
  existingIds: string[],
  incoming: T[],
): OrderPaymentDiff<T> {
  const existing = new Set(existingIds);
  const keep: OrderPaymentDiff<T>['keep'] = [];
  const add: T[] = [];
  for (const row of incoming) {
    if (row.id && existing.has(row.id)) {
      keep.push({ id: row.id, incoming: row });
    } else {
      add.push(row);
    }
  }
  return { keep, add };
}

/**
 * Report statuses at which a test can no longer be removed from an order — the
 * result has been filled/generated. Deletable only while a test has no report or
 * its reports are still PENDING / PARTIAL_PENDING.
 */
export const BLOCKING_REPORT_STATUSES: readonly LabReportStatus[] = [
  LabReportStatus.SAVED,
  LabReportStatus.VALIDATION_PENDING,
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
  LabReportStatus.ERROR_REPORTED,
  LabReportStatus.RESULT_REJECTED,
];

/**
 * O(1) membership view of {@link BLOCKING_REPORT_STATUSES}, derived from it so the
 * two never drift. Mirrors the `ReadonlySet<LabReportStatus>` status-set pattern
 * used elsewhere (e.g. `accession/constants/tat.constant.ts`).
 */
const BLOCKING_REPORT_STATUS_SET: ReadonlySet<LabReportStatus> = new Set(
  BLOCKING_REPORT_STATUSES,
);

/**
 * Whether a test (with the given report statuses across its LabReports) may still
 * be removed. True when none of its reports has reached a blocking status.
 * @param reportStatuses the statuses of every LabReport for the test being removed
 */
export function isTestDeletable(reportStatuses: LabReportStatus[]): boolean {
  return !reportStatuses.some((s) => BLOCKING_REPORT_STATUS_SET.has(s));
}

/**
 * Whether an update's payment ledger is a disallowed overpayment. A surplus that
 * results from the order's net dropping below what was already paid (e.g. a paid
 * test removed) is allowed — it becomes a refundable negative balance. Only
 * COLLECTING more than owed (paid increased beyond both net and the prior paid)
 * is rejected.
 * @param payPaid summed paidAmount on the incoming ledger
 * @param payNet summed netAmount on the incoming ledger (new order value)
 * @param storedPaid summed paidAmount already recorded on the order before update
 */
export function isDisallowedOverpayment(
  payPaid: number,
  payNet: number,
  storedPaid: number,
): boolean {
  return payPaid > payNet && payPaid > storedPaid;
}
