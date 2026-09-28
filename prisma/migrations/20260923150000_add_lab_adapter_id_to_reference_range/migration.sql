-- Adds the missing link from an Adapter-wise reference range (ref_range_type =
-- ADAPTER) to the specific LabAdapter it applies to. Logical ref (no FK),
-- validated in LabTestService — same pattern as equipment_id/branch_id
-- elsewhere in this codebase. One adapter's range applies wherever that
-- adapter is deployed (it is not further scoped by branch on this row).
ALTER TABLE "lab_test_reference_ranges" ADD COLUMN "lab_adapter_id" TEXT;

CREATE INDEX "lab_test_reference_ranges_lab_adapter_id_idx" ON "lab_test_reference_ranges"("lab_adapter_id");
