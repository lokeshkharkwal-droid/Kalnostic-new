-- CreateEnum
CREATE TYPE "PersonMappingType" AS ENUM ('USER', 'CONSULTANT_DOCTOR', 'REPORTING_DOCTOR', 'EXTERNAL_REFERRAL');

-- AlterTable
ALTER TABLE "category_person_mappings" ADD COLUMN     "branch_id" TEXT,
ADD COLUMN     "type" "PersonMappingType" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "department_person_mappings" ADD COLUMN     "branch_id" TEXT,
ADD COLUMN     "type" "PersonMappingType" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "sub_category_person_mappings" ADD COLUMN     "branch_id" TEXT,
ADD COLUMN     "type" "PersonMappingType" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "category_person_mappings_branch_id_idx" ON "category_person_mappings"("branch_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_branch_id_idx" ON "department_person_mappings"("branch_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_branch_id_idx" ON "sub_category_person_mappings"("branch_id");
