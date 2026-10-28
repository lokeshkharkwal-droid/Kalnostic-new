-- Record whether the patient was pregnant at the time of an order (the
-- "Pregnant" checkbox in Create Order → Patient Details). Stored per order —
-- not on the patient — so ticking it today never changes the patient's past or
-- future orders. Only valid for a FEMALE patient (enforced in OrderService).
-- NOT NULL DEFAULT false so every existing order stays valid (not pregnant).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "is_pregnant" BOOLEAN NOT NULL DEFAULT false;
