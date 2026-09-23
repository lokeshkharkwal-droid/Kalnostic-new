-- Per-report Notes overrides (Useful For / Interpretation / Limitations /
-- Remarks / References). NULL = inherit the linked LabTest's configured
-- default; a non-null value overrides it for this report only, without ever
-- touching the shared LabTest row.
ALTER TABLE "lab_reports" ADD COLUMN "useful_for" TEXT;
ALTER TABLE "lab_reports" ADD COLUMN "interpretation_of_results" TEXT;
ALTER TABLE "lab_reports" ADD COLUMN "limitations" TEXT;
ALTER TABLE "lab_reports" ADD COLUMN "remarks" TEXT;
ALTER TABLE "lab_reports" ADD COLUMN "references" TEXT;

-- Per-field technician-editability toggles for the 3 Notes sections that
-- were previously always read-only in Test Entry (Useful For/Interpretation
-- already had their own toggles).
ALTER TABLE "technician_settings" ADD COLUMN "is_limitations_editable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "technician_settings" ADD COLUMN "is_remarks_editable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "technician_settings" ADD COLUMN "is_references_editable" BOOLEAN NOT NULL DEFAULT false;
