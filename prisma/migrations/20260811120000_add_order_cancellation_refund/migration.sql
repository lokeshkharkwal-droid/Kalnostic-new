-- Cancellation & refund support (minor units).
--
-- A ledger entry is now typed: PAYMENT (money collected) or REFUND (money
-- returned to the patient). REFUND rows carry the returned amount in
-- `refund_amount` (with `paid_amount` left at 0) so existing paid-amount sums and
-- the overpayment guard are unaffected; `refund_charge` is the fee retained by
-- the lab on a standalone "Refund Without Cancellation". Orders gain a
-- `cancellation_charge` fee retained on cancellation (caps the refundable amount).
-- Existing rows backfill to PAYMENT / 0.
CREATE TYPE "PaymentEntryType" AS ENUM ('PAYMENT', 'REFUND');

ALTER TABLE "payment_details"
  ADD COLUMN "entry_type" "PaymentEntryType" NOT NULL DEFAULT 'PAYMENT',
  ADD COLUMN "refund_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refund_charge" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN "cancellation_charge" INTEGER NOT NULL DEFAULT 0;
