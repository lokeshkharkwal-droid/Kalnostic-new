-- Patient photo (S3 URL, uploaded from device or captured via webcam at
-- registration). Persists across visits; surfaced to report templates as
-- `{patient_image}` / `{{image:patient_image}}`. Nullable, no backfill; RLS is
-- unaffected (new column on an existing tenant-scoped table).
ALTER TABLE "patients" ADD COLUMN "photo_url" TEXT;
