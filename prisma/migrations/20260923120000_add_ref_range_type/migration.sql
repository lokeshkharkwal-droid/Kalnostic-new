-- Adds the Default-wise / Adapter-wise toggle to numeric reference ranges
-- (Reference Range Master screen). DEFAULT preserves today's only behavior;
-- ADAPTER is captured for future adapter-scoped range resolution (see
-- share/LIS_adapter_default/) but is not yet consumed by EMI result matching.
-- Also adds `unit`, so a range row can carry its own reporting unit
-- (independent of the parent parameter's `reportingUnit`) for the Copy /
-- Parameter-prefill workflow on the Reference Range Master screen.
CREATE TYPE "RefRangeType" AS ENUM (
  'DEFAULT',
  'ADAPTER'
);

ALTER TABLE "lab_test_reference_ranges" ADD COLUMN "ref_range_type" "RefRangeType" NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "lab_test_reference_ranges" ADD COLUMN "unit" TEXT;
