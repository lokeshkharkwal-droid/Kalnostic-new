-- Overall Result moves from being one shared field per REPORT to one row per
-- PARAMETER on that report (a test can have several parameters, e.g.
-- Bilirubin/SGOT/SGPT under Liver Function Test, each independently tagged
-- into its own lab_test_result_params.overall_result_groups and each capable
-- of holding its own separately-applied Overall Result). The old columns
-- wrongly modeled this as one-per-report: applying a template from one
-- parameter's row silently overwrote whatever another parameter's row had
-- applied, since both wrote the same two columns on lab_reports.
--
-- The two dropped columns are NOT backfilled into the new table: existing
-- data never recorded which parameter its content belonged to, so there is
-- no accurate row to migrate it into. Any lab_reports row with
-- overall_result_content set before this migration loses that content —
-- check for and manually preserve any real applied content BEFORE running
-- this migration in an environment where it matters (see the accompanying
-- runbook note).

-- DropColumn
ALTER TABLE "lab_reports" DROP COLUMN "overall_result_template_id";
ALTER TABLE "lab_reports" DROP COLUMN "overall_result_content";

-- CreateTable
CREATE TABLE "lab_report_overall_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lab_report_id" TEXT NOT NULL,
    "result_param_id" TEXT NOT NULL,
    "template_id" TEXT,
    "content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_report_overall_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_report_overall_results_tenant_id_idx" ON "lab_report_overall_results"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_report_overall_results_lab_report_id_idx" ON "lab_report_overall_results"("lab_report_id");

-- CreateIndex
CREATE INDEX "lab_report_overall_results_result_param_id_idx" ON "lab_report_overall_results"("result_param_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_report_overall_results_lab_report_id_result_param_id_key" ON "lab_report_overall_results"("lab_report_id", "result_param_id");

-- AddForeignKey
ALTER TABLE "lab_report_overall_results" ADD CONSTRAINT "lab_report_overall_results_lab_report_id_fkey" FOREIGN KEY ("lab_report_id") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
