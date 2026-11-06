-- Denormalized billing rollups on `orders` — the gross / discount / net / paid /
-- balance / refunded totals the Billings, Quotations, Appointments and Order
-- Console lists render per row. Stored for the same reason as payment_status /
-- bill_status: they are sums over the item + payment ledger that Prisma cannot
-- `ORDER BY`, so the lists previously sorted them client-side (one page at a
-- time) — a violation of the server-side-sort rule. Recomputed in the same
-- transaction as every billing-state write by `recomputeBillStatusInTx`.
ALTER TABLE "orders" ADD COLUMN "gross_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "discount_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "net_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "paid_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "balance_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "refunded_amount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing orders from their active payment ledger. This is a close
-- approximation (gross/net/paid/refunded summed over active PaymentDetails rows,
-- discount = gross − net, balance = max(0, net − paid)); the authoritative
-- item-aware recompute (which re-derives a PERCENT order discount against the
-- current item total) runs on the next billing-state write of each order.
UPDATE "orders" o
SET
  "gross_amount"    = ROUND(COALESCE(agg.gross, 0)),
  "net_amount"      = ROUND(COALESCE(agg.net, 0)),
  "paid_amount"     = ROUND(COALESCE(agg.paid, 0)),
  "refunded_amount" = ROUND(COALESCE(agg.refunded, 0)),
  "discount_amount" = ROUND(GREATEST(0, COALESCE(agg.gross, 0) - COALESCE(agg.net, 0))),
  "balance_amount"  = ROUND(GREATEST(0, COALESCE(agg.net, 0) - COALESCE(agg.paid, 0)))
FROM (
  SELECT
    "order_id",
    SUM("total_amount")  AS gross,
    SUM("net_amount")    AS net,
    SUM("paid_amount")   AS paid,
    SUM("refund_amount") AS refunded
  FROM "payment_details"
  WHERE "deleted_at" IS NULL
  GROUP BY "order_id"
) agg
WHERE o."id" = agg."order_id";
