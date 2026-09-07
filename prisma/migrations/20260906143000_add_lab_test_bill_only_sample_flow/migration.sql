-- The Add Test UI's "Bill Only Test" and "Sample Flow" toggles (Flags
-- section) and the Excel template's matching columns have both existed with
-- no backing DB field — the UI value was silently dropped on save, and
-- export always wrote both columns blank. Adding real columns so they
-- persist and round-trip, matching the "Outsource" fix from earlier today.
ALTER TABLE "lab_test" ADD COLUMN "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lab_test" ADD COLUMN "is_sample_flow" BOOLEAN NOT NULL DEFAULT false;
