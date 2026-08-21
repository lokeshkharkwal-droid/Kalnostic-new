-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "category" TEXT,
    "url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_tenant_id_idx" ON "attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "attachments_branch_id_idx" ON "attachments"("branch_id");

-- CreateIndex
CREATE INDEX "attachments_tenant_id_entity_type_entity_id_idx" ON "attachments"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "attachments_deleted_at_idx" ON "attachments"("deleted_at");
