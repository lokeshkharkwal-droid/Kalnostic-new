-- CreateTable
CREATE TABLE "technician_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "tat_warning_minutes" INTEGER NOT NULL DEFAULT 15,
    "tat_critical_minutes" INTEGER NOT NULL DEFAULT 10,
    "tat_imminent_minutes" INTEGER NOT NULL DEFAULT 5,
    "is_view_rerun_icon_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_view_critical_alert_icon_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_view_out_of_range_icon_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_view_delta_check_icon_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_view_scheduled_test_icon_enabled" BOOLEAN NOT NULL DEFAULT true,
    "authority_signatures" INTEGER NOT NULL DEFAULT 1,
    "signatory_basis" TEXT NOT NULL DEFAULT 'department',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "technician_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technician_settings_tenant_id_idx" ON "technician_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "technician_settings_branch_id_idx" ON "technician_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "technician_settings_tenant_id_branch_id_key" ON "technician_settings"("tenant_id", "branch_id");

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'TECHNICIAN_SETTINGS';
