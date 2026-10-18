-- Links a receiving-branch copy of a sample (created when an INTERNAL transfer is
-- accepted — RULE 1, SampleTransferService.cloneIntoDestination) back to the
-- `sample_transfers` row that produced it. Needed so the receiving branch's
-- Repeat can find its transfer (and the sending branch's original sample) and
-- return the test to the sender. Logical reference, no FK (branch/transfer refs
-- in the accession module are validated in the service). NULL for every ordinary
-- (non-transferred) sample.
ALTER TABLE "order_samples" ADD COLUMN "source_transfer_id" TEXT;

CREATE INDEX "order_samples_source_transfer_id_idx" ON "order_samples"("source_transfer_id");

-- Backfill existing receiving-branch copies: a copy is an active sample at the
-- transfer's destination branch, on the same order, carrying an order item the
-- transferred (original) sample carried, for an accepted INTERNAL transfer.
UPDATE "order_samples" c
SET "source_transfer_id" = t."id"
FROM "sample_transfers" t
JOIN "order_samples" s ON s."id" = t."sample_id"
WHERE c."source_transfer_id" IS NULL
  AND t."kind" = 'INTERNAL'
  AND t."deleted_at" IS NULL
  AND t."accepted_at" IS NOT NULL
  AND c."branch_id" = t."destination_branch_id"
  AND c."order_id" = s."order_id"
  AND c."id" <> s."id"
  AND c."origin_branch_id" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "order_sample_tests" ct
    JOIN "order_sample_tests" st ON st."order_item_id" = ct."order_item_id"
    WHERE ct."sample_id" = c."id" AND st."sample_id" = s."id"
  );
