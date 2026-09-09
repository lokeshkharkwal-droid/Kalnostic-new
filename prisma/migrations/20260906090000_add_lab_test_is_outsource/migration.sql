-- The Add Test UI's "Outsource" toggle (Flags section) and the Excel
-- template's "Outsource" column have both existed with no backing DB field
-- — the UI value was silently dropped on save, and export always wrote this
-- column blank. Adding a real column so it persists and round-trips.
ALTER TABLE "lab_test" ADD COLUMN "is_outsource" BOOLEAN NOT NULL DEFAULT false;
