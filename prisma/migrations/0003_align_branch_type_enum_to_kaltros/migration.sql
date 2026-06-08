-- AlterEnum
-- Align BranchType with the kaltros-master reference set.
-- Removes CLINIC, HOSPITAL, COLLECTION_CENTER (no rows use them).
-- Adds RADIOLOGY, OPD, IPD, INVENTORY, BLOOD_BANK, FRANCHISE, COMBINED.
-- Postgres cannot drop enum values in place, so the type is recreated.
BEGIN;
CREATE TYPE "BranchType_new" AS ENUM ('DIAGNOSTIC', 'RADIOLOGY', 'OPD', 'IPD', 'PHARMACY', 'INVENTORY', 'BLOOD_BANK', 'FRANCHISE', 'COMBINED');
ALTER TABLE "branches" ALTER COLUMN "branch_type" TYPE "BranchType_new" USING ("branch_type"::text::"BranchType_new");
ALTER TYPE "BranchType" RENAME TO "BranchType_old";
ALTER TYPE "BranchType_new" RENAME TO "BranchType";
DROP TYPE "BranchType_old";
COMMIT;
