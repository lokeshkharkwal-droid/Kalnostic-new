-- Choose which Notes sections print (Technician setting + per-report choice).
--
-- Two per-branch switches on technician_settings: one for a single lab test, one
-- for a test that belongs to a lab panel. Both default to ON, so existing and new
-- branch rows get them on. While a switch is OFF every Notes section prints, as
-- before.
ALTER TABLE "technician_settings" ADD COLUMN "is_lab_test_notes_selectable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "technician_settings" ADD COLUMN "is_lab_panel_notes_selectable" BOOLEAN NOT NULL DEFAULT true;

-- The Notes sections a technician left out of one report's printed version
-- (keys: useful_for, interpretation, limitations, remarks, references). Empty
-- (the default) = all five print. Existing reports are unchanged.
ALTER TABLE "lab_reports" ADD COLUMN "excluded_note_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
