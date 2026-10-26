-- Phase 2 of the internal sample transfer: the branch that HOLDS a transferred report works it with ITS OWN
-- Lab Test List entry (report template / PDF settings, TAT windows, department), not the sender's.
--
-- `performing_branch_lab_test_id` points at that entry. NULL (every existing row, and every report that has not
-- left the branch of its order) means "the order line's own entry", exactly as before - so this migration changes
-- nothing for existing data. The order line itself (price, billing) is never touched.
--
-- Idempotent (IF NOT EXISTS / guarded constraint) so a database that already has it is not broken.

ALTER TABLE "lab_reports" ADD COLUMN IF NOT EXISTS "performing_branch_lab_test_id" TEXT;

CREATE INDEX IF NOT EXISTS "lab_reports_performing_branch_lab_test_id_idx"
  ON "lab_reports" ("performing_branch_lab_test_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_reports_performing_branch_lab_test_id_fkey'
  ) THEN
    ALTER TABLE "lab_reports"
      ADD CONSTRAINT "lab_reports_performing_branch_lab_test_id_fkey"
      FOREIGN KEY ("performing_branch_lab_test_id") REFERENCES "branch_lab_tests"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
