-- AlterTable: the tenant-level "Tenant Master Data" singleton has no branch.
ALTER TABLE "master_data" ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable: Tenant→Branch master-data sync provenance.
ALTER TABLE "lab_test" ADD COLUMN     "source_master_lab_test_id" TEXT;
ALTER TABLE "lab_panels" ADD COLUMN     "source_master_lab_panel_id" TEXT;

-- CreateIndex
CREATE INDEX "lab_test_source_master_lab_test_id_idx" ON "lab_test"("source_master_lab_test_id");
CREATE INDEX "lab_panels_source_master_lab_panel_id_idx" ON "lab_panels"("source_master_lab_panel_id");

-- CreateIndex: exactly one active tenant-level master data (branch_id IS NULL) per tenant.
CREATE UNIQUE INDEX "master_data_tenant_singleton_active_unique"
  ON "master_data" ("tenant_id") WHERE "branch_id" IS NULL AND "deleted_at" IS NULL;
