-- Order.checkedInAt: timestamp an appointment order was checked in (Create →
-- Confirm "Check-In", which advances the linked appointment to CHECKED_IN).
-- A checked-in appointment stays status = APPOINTMENT but behaves like an order;
-- the Billings screen uses this as its bill/appointment date, falling back to
-- created_at for plain orders. NULL = never checked in.
ALTER TABLE "orders" ADD COLUMN "checked_in_at" TIMESTAMP(3);
