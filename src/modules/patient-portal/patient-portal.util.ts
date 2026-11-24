import { BillStatus, OrderStatus, PaymentMode } from '@prisma/client';

/**
 * Shared, stateless helpers for the patient-portal read endpoints (billing +
 * transactions). Extracted so the bill and transaction services format bill
 * status, payment mode and patient names identically — the two surfaces must
 * never diverge. Pure functions only (no Prisma / no state).
 */

/** Order statuses that appear as real bills to a patient (never drafts/quotes). */
export const BILL_STATUSES: OrderStatus[] = [
  OrderStatus.APPOINTMENT,
  OrderStatus.ORDER,
  OrderStatus.CANCELLED,
];

/** Human labels for each bill status (mirrors the staff billing palette). */
export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  NOT_PAID: 'Not Paid',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  REQUIRE_REFUND: 'Require Refund',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  FULLY_REFUNDED: 'Fully Refunded',
};

const PAYMENT_MODE_LABELS: Partial<Record<PaymentMode, string>> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Debit Card',
  CREDIT: 'Credit Card',
  WALLET: 'Wallet',
};

/** Round to paisa (mirrors the FE `roundMoney` / backend money rounding). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** First non-blank string (treats null/undefined/"" and whitespace as absent). */
export function firstNonBlank(
  ...values: Array<string | null | undefined>
): string | null {
  for (const v of values) {
    if (v && v.trim().length > 0) return v;
  }
  return null;
}

/** `SNAKE_CASE` enum value → `Title Case` words. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Human label for a payment mode (`Cash`, `UPI`, …); `—` when absent. */
export function paymentModeLabel(mode: PaymentMode | null): string {
  if (!mode) return '—';
  return PAYMENT_MODE_LABELS[mode] ?? titleCase(mode);
}

/** Compose a display name from the patient's name parts (blank parts dropped). */
export function composeName(p: {
  salutation: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
}): string {
  return [p.salutation, p.firstName, p.middleName, p.lastName]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(' ');
}
