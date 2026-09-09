-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'LAB_TEST_FIELD_PERMISSIONS';

-- CreateTable
CREATE TABLE "lab_test_field_permission_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_test_field_permission_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_field_permission_settings_tenant_id_key" ON "lab_test_field_permission_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_field_permission_settings_tenant_id_idx" ON "lab_test_field_permission_settings"("tenant_id");
