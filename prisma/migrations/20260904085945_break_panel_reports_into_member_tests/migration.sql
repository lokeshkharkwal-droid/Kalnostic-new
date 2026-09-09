-- Break down a panel order item's Technician Reporting row into one
-- LabReport per member test, instead of one combined row for the whole
-- panel.
--
-- `member_branch_lab_test_id` (nullable) records which panel member test
-- (BranchLabTest.id, logical ref — no FK, matching BranchLabTest's own
-- no-relation provenance convention) a report is for. Null for a non-panel
-- report, and also null for a panel report created before this change
-- shipped — those existing rows are permanently grandfathered as-is (one
-- combined row, its several parameters staying flattened LabReportResultValue
-- children of that one row); nothing here backfills or splits them.
--
-- The old single-column unique constraint on order_item_id no longer holds,
-- since one panel OrderItem can now back several LabReport rows (one per
-- member test). Replaced with a composite unique on
-- (order_item_id, member_branch_lab_test_id) — Postgres treats each NULL
-- member_branch_lab_test_id as distinct, so this does not by itself stop two
-- non-panel reports sharing an order_item_id; that guarantee is enforced in
-- application code (LabReportService.createReportForAcceptedItem's
-- idempotency check) for the null case, not the database. Verified before
-- writing this migration: no existing lab_reports rows share an
-- order_item_id today, so this composite constraint applies cleanly.
ALTER TABLE "lab_reports" ADD COLUMN "member_branch_lab_test_id" TEXT;

DROP INDEX IF EXISTS "lab_reports_order_item_id_key";

CREATE UNIQUE INDEX "lab_reports_order_item_id_member_branch_lab_test_id_key"
  ON "lab_reports" ("order_item_id", "member_branch_lab_test_id");

CREATE INDEX "lab_reports_order_item_id_idx" ON "lab_reports" ("order_item_id");

CREATE INDEX "lab_reports_member_branch_lab_test_id_idx"
  ON "lab_reports" ("member_branch_lab_test_id");
