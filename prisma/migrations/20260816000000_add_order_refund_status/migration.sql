-- Refund status on orders (minor-unit-agnostic; derived from the refund ledger).
--
-- A fully-paid order that is later refunded had its effective paid amount fall to
-- 0, which made `payment_status` read NOT_PAID — technically correct but
-- misleading. `refund_status` is recomputed alongside `payment_status` whenever a
-- refund ledger row is written, letting the billing/refund lists fold the refund
-- state into the single Status label ("Refunded" / "Partially Refunded") instead
-- of showing "Not Paid". Existing rows backfill to NONE; a follow-up data script
-- recomputes the correct value for orders that already carry REFUND ledger rows.
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED');

ALTER TABLE "orders"
  ADD COLUMN "refund_status" "RefundStatus" NOT NULL DEFAULT 'NONE';
