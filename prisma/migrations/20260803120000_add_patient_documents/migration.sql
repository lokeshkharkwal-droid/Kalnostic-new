-- CreateEnum
CREATE TYPE "PatientDocumentCategory" AS ENUM ('DOCUMENT', 'CONSENT');

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "category" "PatientDocumentCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "document_date" TIMESTAMP(3) NOT NULL,
    "document_url" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_documents_tenant_id_idx" ON "patient_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_documents_patient_id_idx" ON "patient_documents"("patient_id");

-- CreateIndex
CREATE INDEX "patient_documents_branch_id_idx" ON "patient_documents"("branch_id");

-- CreateIndex
CREATE INDEX "patient_documents_category_idx" ON "patient_documents"("category");

-- CreateIndex
CREATE INDEX "patient_documents_deleted_at_idx" ON "patient_documents"("deleted_at");

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
