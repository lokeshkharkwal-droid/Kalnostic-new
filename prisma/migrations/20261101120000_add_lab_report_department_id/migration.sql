-- Denormalize the test's department onto LabReport so the Technician Reporting
-- worklist can filter department visibility directly on the report — the same
-- approach accession uses with OrderSample.department_id. The previous join
-- through order_items.branch_lab_test_id / branch_lab_panel_id resolved a panel
-- member report to the PANEL's single department (branch_lab_panels.department_id)
-- rather than the member test's own, so panel-expanded reports were hidden from
-- (or wrongly shown to) the member test's department.

-- 1. New nullable column (NULL = unassigned → visible to every department).
ALTER TABLE "lab_reports" ADD COLUMN "department_id" TEXT;

-- 2. Index it (department visibility is ANDed into every worklist list/count).
CREATE INDEX "lab_reports_department_id_idx" ON "lab_reports"("department_id");

-- 3. Backfill existing rows, mirroring createReportForAcceptedItem's resolution
--    (prefer the branch lab test's own department, fall back to its source Master
--    Data test's department).

-- 3a. Panel-member reports: use the MEMBER branch lab test's department.
UPDATE "lab_reports" lr
SET "department_id" = COALESCE(blt."department_id", lt."department_id")
FROM "branch_lab_tests" blt
LEFT JOIN "lab_test" lt ON lt."id" = blt."source_lab_test_id"
WHERE lr."member_branch_lab_test_id" = blt."id"
  AND lr."member_branch_lab_test_id" IS NOT NULL;

-- 3b. Non-panel reports: use the order line's branch lab test department.
UPDATE "lab_reports" lr
SET "department_id" = COALESCE(blt."department_id", lt."department_id")
FROM "order_items" oi
JOIN "branch_lab_tests" blt ON blt."id" = oi."branch_lab_test_id"
LEFT JOIN "lab_test" lt ON lt."id" = blt."source_lab_test_id"
WHERE lr."order_item_id" = oi."id"
  AND lr."member_branch_lab_test_id" IS NULL
  AND oi."branch_lab_test_id" IS NOT NULL;
