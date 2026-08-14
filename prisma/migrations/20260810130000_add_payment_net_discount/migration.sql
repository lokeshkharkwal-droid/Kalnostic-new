-- Add a denormalized total-discount rollup to the payment ledger. Stores the
-- sum of every per-line item discount plus the order-level discount (in minor
-- units) for bill display/reporting; the item-level (order_items.discount) and
-- order-level (payment_details.order_discount) discounts stay separate. Existing
-- rows backfill to 0.
ALTER TABLE "payment_details" ADD COLUMN "net_discount" INTEGER NOT NULL DEFAULT 0;
