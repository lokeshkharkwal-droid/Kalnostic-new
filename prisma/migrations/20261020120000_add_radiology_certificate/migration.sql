-- CreateTable
CREATE TABLE "radiology_certificates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "content" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radiology_certificates_tenant_id_idx" ON "radiology_certificates"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_certificates_branch_id_idx" ON "radiology_certificates"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_certificates_master_data_id_idx" ON "radiology_certificates"("master_data_id");

-- CreateIndex
CREATE INDEX "radiology_certificates_is_active_idx" ON "radiology_certificates"("is_active");

-- CreateIndex
CREATE INDEX "radiology_certificates_deleted_at_idx" ON "radiology_certificates"("deleted_at");
