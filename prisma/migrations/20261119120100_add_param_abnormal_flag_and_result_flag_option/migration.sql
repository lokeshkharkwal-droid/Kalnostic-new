-- Abnormal Flag Logic v1.3 — new columns (no data is changed here; the backfill is the
-- next migration, so the locks taken by ALTER TABLE are not held during a long update).
--
-- 1. lab_test_result_params.abnormal_flag_logic — the style now lives on the parameter.
--    OPTIONAL: NULL means "no style set" (decision 2026-11-22). A Default reading of a parameter
--    without a style is never styled automatically, and the Technician's Highlight then starts on the
--    Bold and Red fallback. There is deliberately NO column default: a new parameter stays blank
--    unless somebody picks a style.
-- 2. A CHECK that a "...and High Low" style is only allowed on a QUANTITATIVE parameter
--    (defence in depth; the API rejects it first). Every existing row passes: until now
--    no row could hold one of the new values, and a blank style passes it for every result type
--    (NOT IN over NULL is NULL, which a CHECK accepts).
-- 3. ResultFlagOption + lab_report_result_values.flag_option — the Technician's per-result
--    choice Default / Highlight / Not Highlight. Existing rows start as DEFAULT; the
--    backfill then turns every ticked "Highlight in Report" into HIGHLIGHT.
--
-- lab_test_reference_ranges.abnormal_flag_logic and lab_test_reference_values.abnormal_flag_logic
-- and lab_report_result_values.highlight_in_report are now UNUSED by the app. They are NOT
-- dropped here: they stay read-only until release (a later clean-up migration drops them),
-- so a rollback is still possible.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResultFlagOption') THEN
    CREATE TYPE "ResultFlagOption" AS ENUM ('DEFAULT', 'HIGHLIGHT', 'NOT_HIGHLIGHT');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "lab_test_result_params"
  ADD COLUMN IF NOT EXISTS "abnormal_flag_logic" "AbnormalFlag";

ALTER TABLE "lab_test_result_params" DROP CONSTRAINT IF EXISTS "chk_lab_test_param_high_low_quantitative";
ALTER TABLE "lab_test_result_params" ADD CONSTRAINT "chk_lab_test_param_high_low_quantitative"
  CHECK (
    "abnormal_flag_logic" NOT IN (
      'RED_HIGH_LOW', 'BOLD_HIGH_LOW', 'ITALIC_HIGH_LOW', 'BOLD_AND_ITALIC_HIGH_LOW',
      'BOLD_AND_RED_HIGH_LOW', 'ITALIC_AND_RED_HIGH_LOW', 'BOLD_ITALIC_AND_RED_HIGH_LOW'
    )
    OR "result_type" = 'QUANTITATIVE'
  );

ALTER TABLE "lab_report_result_values"
  ADD COLUMN IF NOT EXISTS "flag_option" "ResultFlagOption" NOT NULL DEFAULT 'DEFAULT';
