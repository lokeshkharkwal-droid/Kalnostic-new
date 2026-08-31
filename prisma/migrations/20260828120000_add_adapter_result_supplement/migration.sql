-- AlterTable: store the machine's raw `test_result_suplement[]` (histogram images
-- as base64 data-URIs) on the EMI audit row.
ALTER TABLE "adapter_results"
  ADD COLUMN "test_result_supplement" JSONB NOT NULL DEFAULT '[]';
