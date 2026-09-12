-- Persist the order-level discount's original input (mode + value) on payment_details
-- so a percentage discount can be recomputed against a new item total when an order
-- is edited (add/remove tests). Mirrors the existing order_items.discount_mode /
-- discount_value columns. Both columns are nullable — pre-existing rows carry NULL,
-- meaning "discount entered as a flat amount (or no discount)".
ALTER TABLE "payment_details"
  ADD COLUMN "order_discount_mode"  "DiscountMode",
  ADD COLUMN "order_discount_value" DOUBLE PRECISION;
