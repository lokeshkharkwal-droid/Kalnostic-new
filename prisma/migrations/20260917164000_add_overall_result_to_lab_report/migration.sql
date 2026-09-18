-- Stores the Overall Result content applied to a report (Technician
-- Dashboard, gated by technician_settings.is_overall_result_editable),
-- snapshotted from an overall_result_templates row the technician picked.
-- Unlike the existing Notes override columns on this table (useful_for,
-- interpretation_of_results, limitations, remarks, references), there is no
-- lab_tests-level fallback for this field — a report with no template
-- applied simply has none. overall_result_template_id is a plain logical
-- reference (no FK, same convention as this table's other cross-module ids)
-- recording which template was applied, purely so the UI can show which one
-- is active; overall_result_content is the actual, technician-editable-after-
-- apply HTML snapshot reports render from.
ALTER TABLE "lab_reports" ADD COLUMN "overall_result_template_id" TEXT;
ALTER TABLE "lab_reports" ADD COLUMN "overall_result_content" TEXT;
