-- AlterEnum
ALTER TYPE "BranchType" ADD VALUE 'COLLECTION_CENTER';

-- CreateTable
CREATE TABLE "collection_center_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "collection_center_id" TEXT NOT NULL,
    "receiving_branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collection_center_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_center_mappings_tenant_id_idx" ON "collection_center_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_collection_center_id_idx" ON "collection_center_mappings"("collection_center_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_receiving_branch_id_idx" ON "collection_center_mappings"("receiving_branch_id");

-- CreateIndex
CREATE INDEX "collection_center_mappings_deleted_at_idx" ON "collection_center_mappings"("deleted_at");
