-- Abnormal Flag Logic — "old reports must not change" (manager decision 2026-11-22, F1-F4).
-- Adds the per-reading frozen print decision. It is written when a report is validated
-- (the only route into a printable status) and read by the print only while the report is
-- printable. NULL = not frozen. Plain ADD COLUMN: nullable, no default, no table rewrite,
-- and the table's existing row-level-security policies already cover the new column.
--
-- Reports that are ALREADY printable get their snapshot from the one-time backfill script
-- (scripts/backfill-print-snapshots.ts), run in the deploy window right after this migration and
-- before the old range/value style columns are dropped (it needs them to reproduce today's print).

ALTER TABLE "lab_report_result_values" ADD COLUMN "print_snapshot" JSONB;
