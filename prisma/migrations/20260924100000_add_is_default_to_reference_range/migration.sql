-- Add is_default to lab_test_reference_ranges
ALTER TABLE "lab_test_reference_ranges" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
