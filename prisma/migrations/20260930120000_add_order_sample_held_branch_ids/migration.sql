-- Every branch a transferred sample has been with. Filled in when an INTERNAL
-- transfer is accepted (SampleTransferService.cloneIntoDestination): the sender's
-- list + the sender + the receiving branch. A sample may never be sent to a branch
-- listed here again (Send / Assign Center refuse it). Empty on a never-transferred
-- sample — its own and origin branch are implied by the check.
ALTER TABLE "order_samples" ADD COLUMN "held_branch_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill existing receiving-branch copies by walking their source_transfer_id
-- chain (copy -> transfer -> sent sample -> its own source transfer ...). UNION
-- (not UNION ALL) drops repeated rows, so a bad link cannot loop forever.
WITH RECURSIVE walk(start_id, cur_id, branch_id, src) AS (
  SELECT "id", "id", "branch_id", "source_transfer_id"
  FROM "order_samples"
  WHERE "source_transfer_id" IS NOT NULL
  UNION
  SELECT w.start_id, p."id", p."branch_id", p."source_transfer_id"
  FROM walk w
  JOIN "sample_transfers" t ON t."id" = w.src
  JOIN "order_samples" p ON p."id" = t."sample_id"
)
UPDATE "order_samples" s
SET "held_branch_ids" = agg.branches
FROM (
  SELECT start_id, array_agg(DISTINCT branch_id) AS branches
  FROM walk
  WHERE branch_id IS NOT NULL
  GROUP BY start_id
) agg
WHERE s."id" = agg.start_id;
