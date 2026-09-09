-- CreateEnum
CREATE TYPE "AdapterAction" AS ENUM ('ORDERS', 'SUBMIT_RESULT', 'OTHER');

-- CreateTable
CREATE TABLE "adapter_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "token" TEXT,
    "action" "AdapterAction" NOT NULL DEFAULT 'OTHER',
    "status" TEXT,
    "status_code" INTEGER,
    "source_ip_address" TEXT,
    "request" TEXT,
    "response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "adapter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adapter_logs_tenant_id_idx" ON "adapter_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "adapter_logs_branch_id_idx" ON "adapter_logs"("branch_id");

-- CreateIndex
CREATE INDEX "adapter_logs_action_idx" ON "adapter_logs"("action");

-- CreateIndex
CREATE INDEX "adapter_logs_created_at_idx" ON "adapter_logs"("created_at");

-- CreateIndex
CREATE INDEX "adapter_logs_deleted_at_idx" ON "adapter_logs"("deleted_at");

-- RenameForeignKey
ALTER TABLE "order_sample_status_history" RENAME CONSTRAINT "accession_status_history_sample_id_fkey" TO "order_sample_status_history_sample_id_fkey";

-- RenameForeignKey
ALTER TABLE "order_sample_tests" RENAME CONSTRAINT "accession_sample_tests_order_item_id_fkey" TO "order_sample_tests_order_item_id_fkey";

-- RenameForeignKey
ALTER TABLE "order_sample_tests" RENAME CONSTRAINT "accession_sample_tests_sample_id_fkey" TO "order_sample_tests_sample_id_fkey";

-- RenameForeignKey
ALTER TABLE "order_samples" RENAME CONSTRAINT "accession_samples_order_id_fkey" TO "order_samples_order_id_fkey";

-- RenameIndex
ALTER INDEX "accession_status_history_branch_id_idx" RENAME TO "order_sample_status_history_branch_id_idx";

-- RenameIndex
ALTER INDEX "accession_status_history_created_at_idx" RENAME TO "order_sample_status_history_created_at_idx";

-- RenameIndex
ALTER INDEX "accession_status_history_deleted_at_idx" RENAME TO "order_sample_status_history_deleted_at_idx";

-- RenameIndex
ALTER INDEX "accession_status_history_sample_id_idx" RENAME TO "order_sample_status_history_sample_id_idx";

-- RenameIndex
ALTER INDEX "accession_status_history_tenant_id_idx" RENAME TO "order_sample_status_history_tenant_id_idx";

-- RenameIndex
ALTER INDEX "accession_sample_tests_branch_id_idx" RENAME TO "order_sample_tests_branch_id_idx";

-- RenameIndex
ALTER INDEX "accession_sample_tests_deleted_at_idx" RENAME TO "order_sample_tests_deleted_at_idx";

-- RenameIndex
ALTER INDEX "accession_sample_tests_order_item_id_idx" RENAME TO "order_sample_tests_order_item_id_idx";

-- RenameIndex
ALTER INDEX "accession_sample_tests_sample_id_idx" RENAME TO "order_sample_tests_sample_id_idx";

-- RenameIndex
ALTER INDEX "accession_sample_tests_tenant_id_idx" RENAME TO "order_sample_tests_tenant_id_idx";

-- RenameIndex
ALTER INDEX "accession_samples_barcode_idx" RENAME TO "order_samples_barcode_idx";

-- RenameIndex
ALTER INDEX "accession_samples_branch_id_idx" RENAME TO "order_samples_branch_id_idx";

-- RenameIndex
ALTER INDEX "accession_samples_deleted_at_idx" RENAME TO "order_samples_deleted_at_idx";

-- RenameIndex
ALTER INDEX "accession_samples_order_id_idx" RENAME TO "order_samples_order_id_idx";

-- RenameIndex
ALTER INDEX "accession_samples_origin_branch_id_idx" RENAME TO "order_samples_origin_branch_id_idx";

-- RenameIndex
ALTER INDEX "accession_samples_processing_branch_id_idx" RENAME TO "order_samples_processing_branch_id_idx";

-- RenameIndex
ALTER INDEX "accession_samples_status_idx" RENAME TO "order_samples_status_idx";

-- RenameIndex
ALTER INDEX "accession_samples_tenant_id_idx" RENAME TO "order_samples_tenant_id_idx";
