-- CreateTable
CREATE TABLE "tat_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "lab_report_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "entered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tat_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tat_adjustments_tenant_id_idx" ON "tat_adjustments"("tenant_id");

-- CreateIndex
CREATE INDEX "tat_adjustments_branch_id_idx" ON "tat_adjustments"("branch_id");

-- CreateIndex
CREATE INDEX "tat_adjustments_lab_report_id_idx" ON "tat_adjustments"("lab_report_id");

-- CreateIndex
CREATE INDEX "tat_adjustments_deleted_at_idx" ON "tat_adjustments"("deleted_at");

-- AddForeignKey
ALTER TABLE "tat_adjustments" ADD CONSTRAINT "tat_adjustments_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
