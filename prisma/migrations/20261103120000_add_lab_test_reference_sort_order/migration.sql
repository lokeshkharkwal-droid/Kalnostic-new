-- Drag-to-reorder for a lab test's Reference Ranges and Reference Values in the
-- Master Data editor. Each row stores its position in the test's whole list
-- (spanning every parameter); reads order by sort_order, then created_at.
-- Existing rows get 0, so they keep their current (creation) order until a test
-- is next saved from the editor.
ALTER TABLE "lab_test_reference_ranges" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lab_test_reference_values" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
