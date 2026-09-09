-- Preserve source EzHealthTrack (MySQL) primary keys on migrated records for
-- idempotent data migration + traceability. All columns are nullable (NULL =
-- natively created, not migrated). `tenants.legacy_tenant_id` is globally unique;
-- the branch/patient/panel legacy ids are unique PER TENANT among ACTIVE rows via
-- partial unique indexes that live in prisma/rls.sql (added in the paired
-- 20260902120100_sync_row_level_security migration). The plain btree indexes here
-- back the idempotent look-ups the migration runner does before each insert.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "legacy_tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "legacy_branch_id" INTEGER;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "legacy_patient_id" INTEGER;

-- AlterTable
ALTER TABLE "referral_panels" ADD COLUMN "legacy_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_legacy_tenant_id_key" ON "tenants"("legacy_tenant_id");

-- CreateIndex
CREATE INDEX "branches_legacy_branch_id_idx" ON "branches"("legacy_branch_id");

-- CreateIndex
CREATE INDEX "patients_legacy_patient_id_idx" ON "patients"("legacy_patient_id");

-- CreateIndex
CREATE INDEX "referral_panels_legacy_id_idx" ON "referral_panels"("legacy_id");
