-- CreateTable
CREATE TABLE "outsource_center_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outsource_center_documents_tenant_id_idx" ON "outsource_center_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_documents_outsource_center_id_idx" ON "outsource_center_documents"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_documents_deleted_at_idx" ON "outsource_center_documents"("deleted_at");

-- AddForeignKey
ALTER TABLE "outsource_center_documents" ADD CONSTRAINT "outsource_center_documents_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
