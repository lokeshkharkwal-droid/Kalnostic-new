-- CreateTable
CREATE TABLE "adapter_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT,
    "token_id" TEXT,
    "adapter_id" TEXT,
    "adapter_code" TEXT,
    "equipment_id" TEXT,
    "tube_information_id" TEXT,
    "tube_no" TEXT,
    "original_tube_no" TEXT,
    "specimen_type" TEXT,
    "result_date" TEXT,
    "sent" TEXT,
    "sent_date" TEXT,
    "status" TEXT,
    "local_db_status" TEXT,
    "comment" TEXT,
    "test_results" JSONB NOT NULL DEFAULT '[]',
    "emi_status" TEXT,
    "update_test_status" TEXT,
    "source_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "adapter_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adapter_results_tenant_id_idx" ON "adapter_results"("tenant_id");

-- CreateIndex
CREATE INDEX "adapter_results_order_id_idx" ON "adapter_results"("order_id");

-- CreateIndex
CREATE INDEX "adapter_results_deleted_at_idx" ON "adapter_results"("deleted_at");
