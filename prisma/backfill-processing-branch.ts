/**
 * One-off backfill for `order_samples.processing_branch_id` on samples that were
 * sent to another branch BEFORE the "processing branch follows an internal send"
 * change landed.
 *
 * Since PR (internal Send / Assign Center now set the source sample's
 * processing_branch_id = destination branch), the origin branch's In-House list
 * shows where a sent sample is being processed. Samples sent earlier still carry
 * the old value (processing = origin), so this aligns them.
 *
 * Run ONCE after deploying:
 *   pnpm exec ts-node prisma/backfill-processing-branch.ts
 *
 * For every sample currently SENT_INTERNAL, set processing_branch_id to the
 * destination of its most recent INTERNAL transfer that has a destination.
 * A single set-based UPDATE — idempotent (re-running is a no-op once aligned).
 *
 * The app connects as a superuser here, so the cross-tenant UPDATE is not blocked
 * by RLS; on a least-privilege connection, run per-tenant with the
 * `app.current_tenant_id` GUC set (see the RLS data-migration convention).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const affected = await prisma.$executeRawUnsafe(`
    UPDATE order_samples s
       SET processing_branch_id = t.destination_branch_id
      FROM (
             SELECT DISTINCT ON (sample_id)
                    sample_id,
                    destination_branch_id
               FROM sample_transfers
              WHERE kind = 'INTERNAL'::"TransferKind"
                AND destination_branch_id IS NOT NULL
                AND deleted_at IS NULL
              ORDER BY sample_id, created_at DESC
           ) t
     WHERE s.id = t.sample_id
       AND s.status = 'SENT_INTERNAL'::"SampleStatus"
       AND s.deleted_at IS NULL
       AND s.processing_branch_id IS DISTINCT FROM t.destination_branch_id
  `);
  console.log(
    `order_samples: aligned processing_branch_id on ${affected} sent sample(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
