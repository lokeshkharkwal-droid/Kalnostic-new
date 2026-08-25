-- Add optional Lab Test List / Lab Panel List assignment to outsource_centers.
-- Purely additive: two nullable logical-ref columns (no FK, mirroring the
-- existing lab_test_id/lab_panel_id columns) plus their lookup indexes. No
-- backfill needed — existing rows simply have both columns NULL.

ALTER TABLE "outsource_centers" ADD COLUMN "branch_lab_test_list_id" TEXT;
ALTER TABLE "outsource_centers" ADD COLUMN "branch_lab_panel_list_id" TEXT;

CREATE INDEX "outsource_centers_branch_lab_test_list_id_idx" ON "outsource_centers"("branch_lab_test_list_id");
CREATE INDEX "outsource_centers_branch_lab_panel_list_id_idx" ON "outsource_centers"("branch_lab_panel_list_id");
