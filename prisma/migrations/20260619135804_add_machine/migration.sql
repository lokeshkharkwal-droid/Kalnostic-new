-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'ERROR');

-- CreateEnum
CREATE TYPE "AdapterLogType" AS ENUM ('ERROR', 'INFO', 'WARNING');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'MACHINE';

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "code" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_no" TEXT,
    "department_id" TEXT,
    "status" "MachineStatus" NOT NULL DEFAULT 'OFFLINE',
    "last_calibration_date" TIMESTAMP(3),
    "last_maintenance_date" TIMESTAMP(3),
    "next_calibration_date" TIMESTAMP(3),
    "next_maintenance_due" TIMESTAMP(3),
    "analyser_image" TEXT,
    "machine_notes" TEXT,
    "interface_type" TEXT,
    "token_number" TEXT,
    "connection_type" TEXT,
    "host_pc_ip_address" TEXT,
    "analyser_ip_address" TEXT,
    "port" INTEGER,
    "is_adapter_server" BOOLEAN,
    "adapter_supports" TEXT[],
    "reference_images" TEXT[],
    "interface_note" TEXT,
    "is_bidirectional_interface" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_validate_results" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_flag_critical" BOOLEAN NOT NULL DEFAULT false,
    "interface_configuration_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_reagent_kits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "reagent_kit_name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_reagent_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_test_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "lis_code" TEXT NOT NULL,
    "lis_test_name" TEXT NOT NULL,
    "analyzer_code" TEXT NOT NULL,
    "analyzer_name" TEXT NOT NULL,
    "unit" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_test_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_adapter_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "log_type" "AdapterLogType",
    "status" TEXT,
    "source_ip" TEXT,
    "is_viewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_adapter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_branches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "machine_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machines_tenant_id_idx" ON "machines"("tenant_id");

-- CreateIndex
CREATE INDEX "machines_department_id_idx" ON "machines"("department_id");

-- CreateIndex
CREATE INDEX "machines_deleted_at_idx" ON "machines"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_tenant_id_idx" ON "machine_reagent_kits"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_machine_id_idx" ON "machine_reagent_kits"("machine_id");

-- CreateIndex
CREATE INDEX "machine_reagent_kits_deleted_at_idx" ON "machine_reagent_kits"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_test_mappings_tenant_id_idx" ON "machine_test_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_test_mappings_machine_id_idx" ON "machine_test_mappings"("machine_id");

-- CreateIndex
CREATE INDEX "machine_test_mappings_deleted_at_idx" ON "machine_test_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_tenant_id_idx" ON "machine_adapter_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_machine_id_idx" ON "machine_adapter_logs"("machine_id");

-- CreateIndex
CREATE INDEX "machine_adapter_logs_deleted_at_idx" ON "machine_adapter_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "machine_branches_tenant_id_idx" ON "machine_branches"("tenant_id");

-- CreateIndex
CREATE INDEX "machine_branches_machine_id_idx" ON "machine_branches"("machine_id");

-- CreateIndex
CREATE INDEX "machine_branches_branch_id_idx" ON "machine_branches"("branch_id");
