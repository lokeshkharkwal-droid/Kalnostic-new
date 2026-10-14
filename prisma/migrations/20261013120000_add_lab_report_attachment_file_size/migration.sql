-- Add a nullable server-measured byte size to lab report attachments, used to
-- enforce the per-report total-size limit on Test Entry "File +" uploads.
-- Nullable so existing rows (and EMI-written histogram rows) remain valid.
ALTER TABLE "lab_report_attachments" ADD COLUMN "file_size_bytes" INTEGER;
