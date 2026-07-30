-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('NEW', 'COLLECTED', 'ACCEPTED', 'ACQUIRED', 'HALT', 'ERROR', 'HOLD', 'REPEAT', 'SENT_INTERNAL', 'FORWARD_EXTERNAL', 'STORED', 'DISCARDED', 'RETURNED', 'CANCELLED', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('INTERNAL', 'EXTERNAL', 'OUTSOURCE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'PICKED_UP', 'RECEIVED', 'ACCEPTED', 'REPEAT', 'REJECTED');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'ACCESSION';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "accession_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "accession_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "accession_no" TEXT NOT NULL,
    "barcode" TEXT,
    "sample_type" TEXT,
    "container_type" "ContainerType",
    "sample_group_label" TEXT,
    "status" "SampleStatus" NOT NULL DEFAULT 'NEW',
    "previous_status" "SampleStatus",
    "priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "report_status" TEXT,
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "tube_type" TEXT,
    "received_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "sample_condition" TEXT,
    "store_location" TEXT,
    "logistics_type" TEXT,
    "logistics_person" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "origin_branch_id" TEXT,
    "processing_branch_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_sample_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "test_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_sample_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "to_status" "SampleStatus" NOT NULL,
    "from_status" "SampleStatus",
    "reason" TEXT,
    "notes" TEXT,
    "attachment_url" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "sample_id" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "transfer_status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "origin_branch_id" TEXT,
    "destination_branch_id" TEXT,
    "outsource_center_id" TEXT,
    "external_partner_ref" TEXT,
    "external_partner_name" TEXT,
    "send_date" TIMESTAMP(3),
    "send_time" TEXT,
    "sample_form" TEXT,
    "logistics_type" TEXT,
    "logistics_person" TEXT,
    "picked_up_by" TEXT,
    "picked_up_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "receive_condition" TEXT,
    "accepted_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "repeat_reason" TEXT,
    "outsource_status" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sample_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accession_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accession_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accession_samples_tenant_id_idx" ON "accession_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_samples_branch_id_idx" ON "accession_samples"("branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_order_id_idx" ON "accession_samples"("order_id");

-- CreateIndex
CREATE INDEX "accession_samples_status_idx" ON "accession_samples"("status");

-- CreateIndex
CREATE INDEX "accession_samples_barcode_idx" ON "accession_samples"("barcode");

-- CreateIndex
CREATE INDEX "accession_samples_origin_branch_id_idx" ON "accession_samples"("origin_branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_processing_branch_id_idx" ON "accession_samples"("processing_branch_id");

-- CreateIndex
CREATE INDEX "accession_samples_deleted_at_idx" ON "accession_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_sample_tests_tenant_id_idx" ON "accession_sample_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_branch_id_idx" ON "accession_sample_tests"("branch_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_sample_id_idx" ON "accession_sample_tests"("sample_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_order_item_id_idx" ON "accession_sample_tests"("order_item_id");

-- CreateIndex
CREATE INDEX "accession_sample_tests_deleted_at_idx" ON "accession_sample_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_status_history_tenant_id_idx" ON "accession_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_status_history_branch_id_idx" ON "accession_status_history"("branch_id");

-- CreateIndex
CREATE INDEX "accession_status_history_sample_id_idx" ON "accession_status_history"("sample_id");

-- CreateIndex
CREATE INDEX "accession_status_history_created_at_idx" ON "accession_status_history"("created_at");

-- CreateIndex
CREATE INDEX "accession_status_history_deleted_at_idx" ON "accession_status_history"("deleted_at");

-- CreateIndex
CREATE INDEX "sample_transfers_tenant_id_idx" ON "sample_transfers"("tenant_id");

-- CreateIndex
CREATE INDEX "sample_transfers_branch_id_idx" ON "sample_transfers"("branch_id");

-- CreateIndex
CREATE INDEX "sample_transfers_sample_id_idx" ON "sample_transfers"("sample_id");

-- CreateIndex
CREATE INDEX "sample_transfers_kind_idx" ON "sample_transfers"("kind");

-- CreateIndex
CREATE INDEX "sample_transfers_transfer_status_idx" ON "sample_transfers"("transfer_status");

-- CreateIndex
CREATE INDEX "sample_transfers_destination_branch_id_idx" ON "sample_transfers"("destination_branch_id");

-- CreateIndex
CREATE INDEX "sample_transfers_outsource_center_id_idx" ON "sample_transfers"("outsource_center_id");

-- CreateIndex
CREATE INDEX "sample_transfers_deleted_at_idx" ON "sample_transfers"("deleted_at");

-- CreateIndex
CREATE INDEX "accession_settings_tenant_id_idx" ON "accession_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "accession_settings_branch_id_idx" ON "accession_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "accession_settings_tenant_id_branch_id_key" ON "accession_settings"("tenant_id", "branch_id");

-- AddForeignKey
ALTER TABLE "accession_samples" ADD CONSTRAINT "accession_samples_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_sample_tests" ADD CONSTRAINT "accession_sample_tests_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_sample_tests" ADD CONSTRAINT "accession_sample_tests_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accession_status_history" ADD CONSTRAINT "accession_status_history_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_transfers" ADD CONSTRAINT "sample_transfers_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "accession_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
