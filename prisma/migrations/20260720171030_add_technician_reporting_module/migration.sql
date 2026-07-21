-- CreateEnum
CREATE TYPE "LabReportStatus" AS ENUM ('PENDING', 'PARTIAL_PENDING', 'SAVED', 'VALIDATION_PENDING', 'RESULT_DONE', 'APPROVED', 'PUBLISHED', 'ERROR_REPORTED', 'RESULT_REJECTED');

-- CreateEnum
CREATE TYPE "ResultValueSource" AS ENUM ('MANUAL', 'ADAPTER');

-- CreateEnum
CREATE TYPE "LabReportNoteCategory" AS ENUM ('ORDER', 'SAMPLE', 'TECH', 'LOCK', 'DELTA', 'CRITICAL_ALERT', 'OUT_OF_RANGE', 'RE_RUN', 'SCHEDULE', 'ERROR_REPORTED', 'RESULT_REJECTED', 'UPDATE_STATUS');

-- CreateEnum
CREATE TYPE "WorklistStatus" AS ENUM ('NEW', 'PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DeltaCheckStatus" AS ENUM ('NEW', 'REVIEWED', 'RE_RUN', 'ACCEPTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorklistTrigger" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "MultiStepProcessType" AS ENUM ('HISTOPATHOLOGY_ROUTINE', 'BONE_MARROW_WORKUP', 'CYTOLOGY_WORKFLOW', 'IMMUNOHISTOCHEMISTRY_PANEL');

-- CreateEnum
CREATE TYPE "MultiStepStage" AS ENUM ('GROSSING', 'SECTIONING', 'STAINING', 'REPORTING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditModule" ADD VALUE 'LAB_REPORT';
ALTER TYPE "AuditModule" ADD VALUE 'RE_RUN_REQUEST';
ALTER TYPE "AuditModule" ADD VALUE 'CRITICAL_ALERT';
ALTER TYPE "AuditModule" ADD VALUE 'OUT_OF_RANGE_FLAG';
ALTER TYPE "AuditModule" ADD VALUE 'DELTA_CHECK';
ALTER TYPE "AuditModule" ADD VALUE 'SCHEDULED_TEST';

-- CreateTable
CREATE TABLE "lab_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_item_id" TEXT NOT NULL,
    "lab_test_id" TEXT,
    "status" "LabReportStatus" NOT NULL DEFAULT 'PENDING',
    "saved_at" TIMESTAMP(3),
    "saved_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "validated_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_notes" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_result_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "result_param_id" TEXT NOT NULL,
    "observed_1" TEXT,
    "observed_2" TEXT,
    "unit" TEXT,
    "methodology" TEXT,
    "reference_range_id" TEXT,
    "reference_display" TEXT,
    "source" "ResultValueSource" NOT NULL DEFAULT 'MANUAL',
    "entered_at" TIMESTAMP(3),
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_report_result_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "category" "LabReportNoteCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "notes" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "fromStatus" "LabReportStatus",
    "toStatus" "LabReportStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "re_run_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'NEW',
    "requested_by" TEXT NOT NULL,
    "request_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "re_run_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "report_status_at_trigger" "LabReportStatus" NOT NULL,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "critical_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "out_of_range_flags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "report_status_at_trigger" "LabReportStatus" NOT NULL,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "out_of_range_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delta_checks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "DeltaCheckStatus" NOT NULL DEFAULT 'NEW',
    "trigger" "WorklistTrigger" NOT NULL DEFAULT 'MANUAL',
    "previous_result_value_id" TEXT,
    "result_param_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "delta_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "dispatch_at" TIMESTAMP(3),
    "assigned_to_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scheduled_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multi_step_test_processes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "process_type" "MultiStepProcessType" NOT NULL,
    "current_stage" "MultiStepStage" NOT NULL DEFAULT 'GROSSING',
    "stage_history" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "multi_step_test_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_inventory_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "batch_number" TEXT,
    "expiry_date" DATE,
    "allocated_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allocated_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "re_run_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "re_run_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "wastage_pu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "wastage_bu" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_report_inventory_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_order_item_id_key" ON "lab_reports"("order_item_id");

-- CreateIndex
CREATE INDEX "lab_reports_tenant_id_idx" ON "lab_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_reports_branch_id_idx" ON "lab_reports"("branch_id");

-- CreateIndex
CREATE INDEX "lab_reports_status_idx" ON "lab_reports"("status");

-- CreateIndex
CREATE INDEX "lab_reports_lab_test_id_idx" ON "lab_reports"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_reports_deleted_at_idx" ON "lab_reports"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_report_result_values_tenant_id_idx" ON "lab_report_result_values"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_result_values_lab_report_id_idx" ON "lab_report_result_values"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_result_values_result_param_id_idx" ON "lab_report_result_values"("result_param_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_result_values_lab_report_id_result_param_id_key" ON "lab_report_result_values"("lab_report_id", "result_param_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_tenant_id_idx" ON "lab_report_notes"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_lab_report_id_idx" ON "lab_report_notes"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_notes_category_idx" ON "lab_report_notes"("category");

-- CreateIndex
CREATE INDEX "lab_report_attachments_tenant_id_idx" ON "lab_report_attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_attachments_lab_report_id_idx" ON "lab_report_attachments"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_history_tenant_id_idx" ON "lab_report_history"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_history_lab_report_id_idx" ON "lab_report_history"("lab_report_id");

-- CreateIndex
CREATE INDEX "re_run_requests_tenant_id_idx" ON "re_run_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "re_run_requests_branch_id_idx" ON "re_run_requests"("branch_id");

-- CreateIndex
CREATE INDEX "re_run_requests_lab_report_id_idx" ON "re_run_requests"("lab_report_id");

-- CreateIndex
CREATE INDEX "re_run_requests_status_idx" ON "re_run_requests"("status");

-- CreateIndex
CREATE INDEX "critical_alerts_tenant_id_idx" ON "critical_alerts"("tenant_id");

-- CreateIndex
CREATE INDEX "critical_alerts_branch_id_idx" ON "critical_alerts"("branch_id");

-- CreateIndex
CREATE INDEX "critical_alerts_lab_report_id_idx" ON "critical_alerts"("lab_report_id");

-- CreateIndex
CREATE INDEX "critical_alerts_status_idx" ON "critical_alerts"("status");

-- CreateIndex
CREATE INDEX "out_of_range_flags_tenant_id_idx" ON "out_of_range_flags"("tenant_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_branch_id_idx" ON "out_of_range_flags"("branch_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_lab_report_id_idx" ON "out_of_range_flags"("lab_report_id");

-- CreateIndex
CREATE INDEX "out_of_range_flags_status_idx" ON "out_of_range_flags"("status");

-- CreateIndex
CREATE INDEX "delta_checks_tenant_id_idx" ON "delta_checks"("tenant_id");

-- CreateIndex
CREATE INDEX "delta_checks_branch_id_idx" ON "delta_checks"("branch_id");

-- CreateIndex
CREATE INDEX "delta_checks_lab_report_id_idx" ON "delta_checks"("lab_report_id");

-- CreateIndex
CREATE INDEX "delta_checks_status_idx" ON "delta_checks"("status");

-- CreateIndex
CREATE INDEX "scheduled_tests_tenant_id_idx" ON "scheduled_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_branch_id_idx" ON "scheduled_tests"("branch_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_lab_report_id_idx" ON "scheduled_tests"("lab_report_id");

-- CreateIndex
CREATE INDEX "scheduled_tests_status_idx" ON "scheduled_tests"("status");

-- CreateIndex
CREATE INDEX "scheduled_tests_assigned_to_id_idx" ON "scheduled_tests"("assigned_to_id");

-- CreateIndex
CREATE UNIQUE INDEX "multi_step_test_processes_lab_report_id_key" ON "multi_step_test_processes"("lab_report_id");

-- CreateIndex
CREATE INDEX "multi_step_test_processes_tenant_id_idx" ON "multi_step_test_processes"("tenant_id");

-- CreateIndex
CREATE INDEX "multi_step_test_processes_branch_id_idx" ON "multi_step_test_processes"("branch_id");

-- CreateIndex
CREATE INDEX "lab_report_inventory_usage_tenant_id_idx" ON "lab_report_inventory_usage"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_inventory_usage_lab_report_id_idx" ON "lab_report_inventory_usage"("lab_report_id");

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_result_values" ADD CONSTRAINT "lab_report_result_values_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_notes" ADD CONSTRAINT "lab_report_notes_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_attachments" ADD CONSTRAINT "lab_report_attachments_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_history" ADD CONSTRAINT "lab_report_history_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "re_run_requests" ADD CONSTRAINT "re_run_requests_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_alerts" ADD CONSTRAINT "critical_alerts_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "out_of_range_flags" ADD CONSTRAINT "out_of_range_flags_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delta_checks" ADD CONSTRAINT "delta_checks_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tests" ADD CONSTRAINT "scheduled_tests_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tests" ADD CONSTRAINT "scheduled_tests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_step_test_processes" ADD CONSTRAINT "multi_step_test_processes_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_inventory_usage" ADD CONSTRAINT "lab_report_inventory_usage_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
