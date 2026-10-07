-- Adds `orders.bill_status`: the single billing Status the Registration/Finance
-- → Billings list renders AND filters by (previously the badge was derived in
-- the browser while the filter matched the stored `payment_status`, so a
-- cancelled order still stored as PAID came back under the "Paid" filter).
-- Kept current by `recomputeBillStatusInTx` (src/modules/order/utils/bill-status.ts).

CREATE TYPE "BillStatus" AS ENUM (
  'NOT_PAID',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REQUIRE_REFUND',
  'PARTIALLY_REFUNDED',
  'FULLY_REFUNDED'
);

ALTER TABLE "orders" ADD COLUMN "bill_status" "BillStatus" NOT NULL DEFAULT 'NOT_PAID';

CREATE INDEX "orders_bill_status_idx" ON "orders"("bill_status");

-- Backfill every existing order with the same derivation as `deriveBillStatus`:
--   net  = computeBillingTotals (stored ledger net, with a PERCENT/AMOUNT order
--          discount re-applied against the current Σ item.unit_price)
--   eff  = max(0, paid − cancellation_charge − refunds − refund charges)
--   ladder: CANCELLED → refund states → payment states.
WITH ledger AS (
  SELECT p.order_id,
         SUM(p.net_amount)     AS stored_net,
         SUM(p.order_discount) AS stored_od,
         SUM(p.paid_amount)    AS paid,
         SUM(p.refund_amount)  AS refunded,
         SUM(p.refund_charge)  AS refund_charge
  FROM payment_details p
  WHERE p.deleted_at IS NULL
  GROUP BY p.order_id
),
snap AS (
  SELECT DISTINCT ON (p.order_id)
         p.order_id, p.order_discount_mode AS mode, p.order_discount_value AS value
  FROM payment_details p
  WHERE p.deleted_at IS NULL AND p.order_discount_mode IS NOT NULL
  ORDER BY p.order_id, p.created_at ASC
),
items AS (
  SELECT i.order_id, SUM(i.unit_price)::numeric AS items_total
  FROM order_items i
  WHERE i.deleted_at IS NULL
  GROUP BY i.order_id
),
calc AS (
  SELECT o.id,
         o.status,
         COALESCE(l.refunded, 0) AS refunded,
         ROUND(
           COALESCE(l.stored_net, 0) + COALESCE(l.stored_od, 0)
           - CASE
               WHEN s.mode IS NULL THEN COALESCE(l.stored_od, 0)
               ELSE ROUND(LEAST(
                      GREATEST(
                        CASE WHEN s.mode = 'PERCENT'
                             THEN COALESCE(it.items_total, 0) * COALESCE(s.value, 0)::numeric / 100
                             ELSE COALESCE(s.value, 0)::numeric END,
                        0),
                      GREATEST(COALESCE(it.items_total, 0), 0)), 2)
             END, 2) AS net,
         ROUND(GREATEST(0,
           COALESCE(l.paid, 0) - o.cancellation_charge
           - COALESCE(l.refunded, 0) - COALESCE(l.refund_charge, 0)), 2) AS eff
  FROM orders o
  LEFT JOIN ledger l ON l.order_id = o.id
  LEFT JOIN snap s   ON s.order_id = o.id
  LEFT JOIN items it ON it.order_id = o.id
)
UPDATE "orders" o
SET "bill_status" = (CASE
    WHEN c.status = 'CANCELLED'                         THEN 'CANCELLED'
    WHEN ROUND(c.net - c.eff, 2) < 0 AND c.refunded > 0 THEN 'PARTIALLY_REFUNDED'
    WHEN ROUND(c.net - c.eff, 2) < 0                    THEN 'REQUIRE_REFUND'
    WHEN c.refunded > 0 AND ROUND(c.net - c.eff, 2) = 0 THEN 'FULLY_REFUNDED'
    WHEN c.net <= 0                                     THEN 'PAID'
    WHEN c.eff <= 0                                     THEN 'NOT_PAID'
    WHEN ROUND(c.net - c.eff, 2) = 0                    THEN 'PAID'
    ELSE 'PARTIALLY_PAID'
  END)::"BillStatus"
FROM calc c
WHERE c.id = o.id;
