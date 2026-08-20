-- Widen order/payment money columns from integer (whole rupees) to
-- numeric(12,2) so a real decimal amount (e.g. a payment of ₹100.50) can be
-- stored instead of failing validation or being silently rounded away.
-- int -> numeric is a safe, lossless widening cast: every existing whole
-- value (e.g. 1788) becomes 1788.00, nothing is truncated or lost.

ALTER TABLE "payment_details"
  ALTER COLUMN "total_amount"       TYPE numeric(12,2) USING "total_amount"::numeric(12,2),
  ALTER COLUMN "order_discount"     TYPE numeric(12,2) USING "order_discount"::numeric(12,2),
  ALTER COLUMN "net_discount"       TYPE numeric(12,2) USING "net_discount"::numeric(12,2),
  ALTER COLUMN "visiting_charges"   TYPE numeric(12,2) USING "visiting_charges"::numeric(12,2),
  ALTER COLUMN "net_amount"         TYPE numeric(12,2) USING "net_amount"::numeric(12,2),
  ALTER COLUMN "deduct_from_wallet" TYPE numeric(12,2) USING "deduct_from_wallet"::numeric(12,2),
  ALTER COLUMN "deduct_from_points" TYPE numeric(12,2) USING "deduct_from_points"::numeric(12,2),
  ALTER COLUMN "tds_deduction"      TYPE numeric(12,2) USING "tds_deduction"::numeric(12,2),
  ALTER COLUMN "payable_amount"     TYPE numeric(12,2) USING "payable_amount"::numeric(12,2),
  ALTER COLUMN "paid_amount"        TYPE numeric(12,2) USING "paid_amount"::numeric(12,2),
  ALTER COLUMN "remaining_balance"  TYPE numeric(12,2) USING "remaining_balance"::numeric(12,2),
  ALTER COLUMN "refund_amount"      TYPE numeric(12,2) USING "refund_amount"::numeric(12,2),
  ALTER COLUMN "refund_charge"      TYPE numeric(12,2) USING "refund_charge"::numeric(12,2);

ALTER TABLE "orders"
  ALTER COLUMN "cancellation_charge" TYPE numeric(12,2) USING "cancellation_charge"::numeric(12,2);

ALTER TABLE "order_items"
  ALTER COLUMN "discount" TYPE numeric(12,2) USING "discount"::numeric(12,2);
