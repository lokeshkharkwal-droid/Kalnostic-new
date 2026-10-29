-- Per-report, per-parameter Note (Technician > Reporting > the Notes icon beside Sync).
--
-- A report with no live row here keeps showing and printing the parameter's configured
-- Note (lab_test_result_params.notes); a row replaces it for that one report. content is
-- rich-text HTML and may be '' (the technician blanked the note on purpose). deleted_at is
-- set when a test goes back for a repeat, so the default note shows again; the next save
-- revives the row. New table, no existing data touched.

-- CreateTable
CREATE TABLE "lab_report_parameter_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "result_param_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_report_parameter_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_report_parameter_notes_tenant_id_idx" ON "lab_report_parameter_notes"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_parameter_notes_lab_report_id_idx" ON "lab_report_parameter_notes"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_parameter_notes_result_param_id_idx" ON "lab_report_parameter_notes"("result_param_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_parameter_notes_lab_report_id_result_param_id_key" ON "lab_report_parameter_notes"("lab_report_id", "result_param_id");

-- AddForeignKey
ALTER TABLE "lab_report_parameter_notes" ADD CONSTRAINT "lab_report_parameter_notes_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: same tenant-isolation policy as every other report table (tenant_id is
-- NOT NULL, so no `OR tenant_id IS NULL`). Mirrors the block added to prisma/rls.sql.
-- Rollback: ALTER TABLE lab_report_parameter_notes NO FORCE ROW LEVEL SECURITY;
--           ALTER TABLE lab_report_parameter_notes DISABLE ROW LEVEL SECURITY;
--           DROP POLICY lab_report_parameter_notes_tenant_isolation ON lab_report_parameter_notes;
ALTER TABLE lab_report_parameter_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_parameter_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_parameter_notes_tenant_isolation ON lab_report_parameter_notes;
CREATE POLICY lab_report_parameter_notes_tenant_isolation ON lab_report_parameter_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
