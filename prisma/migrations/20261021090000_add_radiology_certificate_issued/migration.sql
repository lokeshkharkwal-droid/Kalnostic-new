-- CreateTable: issued radiology certificates (EzHealthTrack rad_certificate_history tier)
CREATE TABLE "radiology_certificates_issued" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "certificate_id" TEXT,
    "certificate_name" TEXT NOT NULL,
    "group_name" TEXT,
    "study_id" TEXT NOT NULL,
    "order_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "issued_by" TEXT,
    "content" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_certificates_issued_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radiology_certificates_issued_tenant_id_idx" ON "radiology_certificates_issued"("tenant_id");
CREATE INDEX "radiology_certificates_issued_branch_id_idx" ON "radiology_certificates_issued"("branch_id");
CREATE INDEX "radiology_certificates_issued_study_id_idx" ON "radiology_certificates_issued"("study_id");
CREATE INDEX "radiology_certificates_issued_patient_id_idx" ON "radiology_certificates_issued"("patient_id");
CREATE INDEX "radiology_certificates_issued_deleted_at_idx" ON "radiology_certificates_issued"("deleted_at");
