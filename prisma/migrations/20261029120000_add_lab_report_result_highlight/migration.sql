-- Per-report, technician-set highlighting of a QUALITATIVE / SEMI_QUANTITATIVE
-- parameter's observed value(s) in the generated report. Quantitative values are
-- already flagged automatically from their numeric reference range, so this manual
-- control is scoped to the two categorical result types (enforced in the app).
--   highlight_in_report : whether to highlight this parameter's observed value(s)
--   highlight_logic     : which styling to apply (reuses the AbnormalFlag palette;
--                         only BOLD_AND_RED is offered in the UI today). NULL when
--                         highlighting is off / never configured.
-- NOT NULL DEFAULT false keeps every existing row valid without a backfill.
ALTER TABLE "lab_report_result_values" ADD COLUMN "highlight_in_report" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lab_report_result_values" ADD COLUMN "highlight_logic" "AbnormalFlag";
