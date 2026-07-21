-- One-off backfill for Order.payment_status (added alongside the appointments
-- payment-status filter). New orders set this at create time and every payment
-- write keeps it in sync; this recomputes it for orders that predate the column.
--
-- Run once as a role that bypasses RLS (the DB owner/superuser — e.g. psql from
-- the PostgreSQL bin), since it spans all tenants. Idempotent: safe to re-run.
-- Orders with no active payments keep the NOT_PAID default.
UPDATE orders o
SET payment_status = (
  CASE
    WHEN COALESCE(p.paid, 0) <= 0 THEN 'NOT_PAID'
    WHEN COALESCE(p.paid, 0) >= COALESCE(p.net, 0) THEN 'PAID'
    ELSE 'PARTIALLY_PAID'
  END
)::"PaymentStatus"
FROM (
  SELECT order_id,
         SUM(net_amount)  AS net,
         SUM(paid_amount) AS paid
  FROM payment_details
  WHERE deleted_at IS NULL
  GROUP BY order_id
) p
WHERE o.id = p.order_id;
