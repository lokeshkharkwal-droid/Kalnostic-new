-- Removes the Default-wise / Adapter-wise `ref_range_type` field entirely.
-- `lab_adapter_id` (already nullable) is now the sole source of truth: NULL
-- means the range is not scoped to any analyzer ("Default"), a real id means
-- it's Adapter-wise. Every existing row's `ref_range_type` already matched
-- `lab_adapter_id`'s nullness (DEFAULT rows have always had a null
-- lab_adapter_id, ADAPTER rows a real one), so no data backfill is needed —
-- this only drops the now-redundant column and its enum type.
ALTER TABLE "lab_test_reference_ranges" DROP COLUMN "ref_range_type";

DROP TYPE "RefRangeType";
