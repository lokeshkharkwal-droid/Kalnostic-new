-- Technician Reporting worklist: the standalone "Outsource" checkbox is widened
-- from "outsourced to an external center" to a superset of referral/transfer
-- work, so a sample received from another branch (via /accession/referral-orders)
-- or forwarded to an outside partner (/accession/external-referral-orders) also
-- surfaces under it. `is_outsourced` only mirrors `order_items.outsource_center_id`
-- and so never captured those transfers. `is_referral` is a new denormalized,
-- indexed flag: true for outsource-out (= is_outsourced) PLUS any sample that
-- reached ACCEPTED through an INTERNAL clone, or whose EXTERNAL/OUTSOURCE transfer
-- was accepted. Kept a plain column so the checkbox filter is a simple equality.
ALTER TABLE "lab_reports"
  ADD COLUMN "is_referral" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "lab_reports_is_referral_idx" ON "lab_reports" ("is_referral");

-- Backfill existing reports to match the new stamping rules.

-- 1. Outsourced-out: identical to the source pill's OUTSOURCE set, stamped at
--    creation and surfaced regardless of transfer status (unchanged behaviour).
UPDATE "lab_reports"
SET "is_referral" = true
WHERE "is_outsourced" = true
  AND "deleted_at" IS NULL;

-- 2. INTERNAL received: the clone materialised at the receiving branch
--    (source_transfer_id set). A clone only exists once the transfer was
--    ACCEPTED, so every clone qualifies. Match the clone's reports held at the
--    clone's branch (same (orderItem, member|labTest) matching the app uses).
UPDATE "lab_reports" lr
SET "is_referral" = true
FROM "order_sample_tests" ost
JOIN "order_samples" os ON os."id" = ost."sample_id"
WHERE lr."order_item_id" = ost."order_item_id"
  AND lr."branch_id" = os."branch_id"
  AND (lr."member_branch_lab_test_id" IS NULL OR lr."lab_test_id" = ost."lab_test_id")
  AND lr."deleted_at" IS NULL
  AND os."deleted_at" IS NULL
  AND ost."deleted_at" IS NULL
  AND os."source_transfer_id" IS NOT NULL;

-- 3. EXTERNAL / OUTSOURCE accepted: the report stays at the sender's branch; flag
--    it only once the transfer is recorded ACCEPTED (Option B — gated on accept).
UPDATE "lab_reports" lr
SET "is_referral" = true
FROM "order_sample_tests" ost
JOIN "order_samples" os ON os."id" = ost."sample_id"
JOIN "sample_transfers" st ON st."sample_id" = os."id"
WHERE lr."order_item_id" = ost."order_item_id"
  AND lr."branch_id" = os."branch_id"
  AND (lr."member_branch_lab_test_id" IS NULL OR lr."lab_test_id" = ost."lab_test_id")
  AND lr."deleted_at" IS NULL
  AND os."deleted_at" IS NULL
  AND ost."deleted_at" IS NULL
  AND st."kind" IN ('EXTERNAL', 'OUTSOURCE')
  AND st."transfer_status" = 'ACCEPTED';
