/**
 * One-off backfill for the `orders.refund_status` column: recomputes the refund
 * state from the existing payment ledger for every order that already carries
 * REFUND rows (new orders default to NONE and are kept current by the app).
 *
 * Run ONCE after adding the column (`prisma db push` / `migrate deploy`):
 *   pnpm exec ts-node prisma/backfill-refund-status.ts
 *
 * Mirrors the app helper `deriveRefundStatus` (src/modules/order/entities/
 * order.entity.ts): effectivePaid = max(0, paid − cancellationCharge − refund −
 * refundCharge); FULLY_REFUNDED once effectivePaid hits 0, else
 * PARTIALLY_REFUNDED. A single set-based UPDATE joined on an aggregate of the
 * active ledger — idempotent (re-running recomputes the same value; orders with
 * no refunds keep the default NONE).
 *
 * The app connects as a superuser here, so the cross-tenant UPDATE is not blocked
 * by RLS; on a least-privilege connection, run per-tenant with the
 * `app.current_tenant_id` GUC set (see the RLS data-migration convention).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const affected = await prisma.$executeRawUnsafe(`
    UPDATE orders o
       SET refund_status = CASE
             WHEN GREATEST(
                    0,
                    agg.paid_sum - o.cancellation_charge - agg.refund_sum - agg.refund_charge_sum
                  ) <= 0
               THEN 'FULLY_REFUNDED'::"RefundStatus"
               ELSE 'PARTIALLY_REFUNDED'::"RefundStatus"
           END
      FROM (
             SELECT order_id,
                    COALESCE(SUM(paid_amount), 0)   AS paid_sum,
                    COALESCE(SUM(refund_amount), 0) AS refund_sum,
                    COALESCE(SUM(refund_charge), 0) AS refund_charge_sum
               FROM payment_details
              WHERE deleted_at IS NULL
              GROUP BY order_id
             HAVING COALESCE(SUM(refund_amount), 0) > 0
           ) agg
     WHERE o.id = agg.order_id
       AND o.deleted_at IS NULL
  `);
  console.log(`orders: recomputed refund_status for ${affected} refunded row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
