-- Persist the per-parameter "Group Layout" display mode (Tabular vs Sequential)
-- and the per-parameter Image Setting reference on result parameters. Both were
-- collected in the Add Result UI but had no column, so the selections were lost
-- when a test was reopened. Additive only — existing rows get NULL.

-- CreateEnum
CREATE TYPE "ResultGroupLayout" AS ENUM ('TABULAR', 'SEQUENTIAL');

-- AlterTable
ALTER TABLE "lab_test_result_params"
  ADD COLUMN "group_layout" "ResultGroupLayout",
  ADD COLUMN "image_settings_id" TEXT;
