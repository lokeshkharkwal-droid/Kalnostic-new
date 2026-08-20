import { PaymentDetails } from '@prisma/client';

/** `PaymentDetails` money field names — `Decimal` columns needing conversion to plain `number`. */
const PAYMENT_DETAILS_MONEY_FIELDS = [
  'totalAmount',
  'orderDiscount',
  'netDiscount',
  'visitingCharges',
  'netAmount',
  'deductFromWallet',
  'deductFromPoints',
  'tdsDeduction',
  'payableAmount',
  'paidAmount',
  'remainingBalance',
  'refundAmount',
  'refundCharge',
] as const;
type PaymentDetailsMoneyField = (typeof PAYMENT_DETAILS_MONEY_FIELDS)[number];

/** Domain/response shape for a payment record — money fields as plain `number` (rupees). */
export type PaymentDetailsEntity = Omit<
  PaymentDetails,
  PaymentDetailsMoneyField
> &
  Record<PaymentDetailsMoneyField, number>;

/**
 * Coerce a Prisma-returned `PaymentDetails` row's `Decimal` money fields to
 * plain `number`, immediately after the read. Arithmetic elsewhere in the app
 * must never touch a raw `Prisma.Decimal` — its `+` operator string-
 * concatenates (`Decimal.valueOf()` returns a string), which silently
 * produces wrong results instead of throwing.
 */
export function mapPaymentDetails(row: PaymentDetails): PaymentDetailsEntity {
  const out = { ...row } as unknown as Record<string, unknown>;
  for (const field of PAYMENT_DETAILS_MONEY_FIELDS) {
    out[field] = row[field].toNumber();
  }
  return out as unknown as PaymentDetailsEntity;
}
