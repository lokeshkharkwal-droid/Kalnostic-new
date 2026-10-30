-- Appointment payments are deferred DRAFTS: the amount entered when an
-- appointment is booked is remembered in this column but NOT collected
-- (`paid_amount` stays 0, so no due, report, or collected-money sum counts it)
-- until the appointment is checked in, when it is committed to a real
-- `paid_amount`. 0 on every ordinary (already-collected) row. NOT NULL DEFAULT 0
-- so every existing payment row stays valid.

-- AlterTable
ALTER TABLE "payment_details" ADD COLUMN "draft_paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
