-- Patient transaction page — classify what a payment was collected FOR.
-- Adds `TransactionType` (APPOINTMENT / ORDER / BILL) and a stamped column on
-- `payment_details`. Going forward the two write paths set it explicitly; here we
-- add it with a safe BILL default and backfill existing rows deterministically.
--
-- Backfill rule (mutually exclusive, in order):
--   1. APPOINTMENT — the payment's order is an appointment booking
--      (orders.appointment_id IS NOT NULL).
--   2. ORDER — a non-appointment payment created in the same transaction as its
--      order. Prisma stamps `@default(now())` client-side per statement, so an
--      inline order-creation payment lands a few hundred ms AFTER its order (not
--      at the identical instant); a tight +3s window captures that cluster while
--      excluding any later counter payment (a human Make-Payment can't open the
--      bill and submit within 3s of order creation).
--   3. BILL — everything else (collected later via Make Payment) keeps the default.
--
-- Plain ADD COLUMN with a default; the table's existing RLS policies already
-- cover the new column, so no rls.sql change is needed.

CREATE TYPE "TransactionType" AS ENUM ('APPOINTMENT', 'ORDER', 'BILL');

ALTER TABLE "payment_details"
  ADD COLUMN "transaction_type" "TransactionType" NOT NULL DEFAULT 'BILL';

-- 1. Appointment payments.
UPDATE "payment_details" pd
SET "transaction_type" = 'APPOINTMENT'
FROM "orders" o
WHERE pd."order_id" = o."id"
  AND o."appointment_id" IS NOT NULL;

-- 2. Non-appointment payments created inline with the order (within +3s).
UPDATE "payment_details" pd
SET "transaction_type" = 'ORDER'
FROM "orders" o
WHERE pd."order_id" = o."id"
  AND o."appointment_id" IS NULL
  AND pd."created_at" >= o."created_at"
  AND pd."created_at" < o."created_at" + interval '3 seconds';

-- 3. Remaining non-appointment rows stay 'BILL' (the column default).
