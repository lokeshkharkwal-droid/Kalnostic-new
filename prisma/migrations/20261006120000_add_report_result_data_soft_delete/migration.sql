-- Soft delete for the result-related data a branch leaves on a report, so a test
-- sent back for a repeat can start clean without losing the audit trail.
-- Additive and idempotent (safe to re-run).
ALTER TABLE "lab_report_notes" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "lab_report_attachments" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "lab_report_overall_results" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
