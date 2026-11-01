-- Print checkboxes are now always shown; the branch's Lab Test / Lab Panel setting only sets the
-- DEFAULT selection (ON = every Notes section ticked, OFF = none ticked). A report therefore needs to
-- remember whether anyone has settled the choice yet:
--   has_chosen_note_print = false : no choice yet, the branch setting decides the default
--   has_chosen_note_print = true  : excluded_note_sections is the choice
-- NOT NULL DEFAULT false keeps every row valid without a rewrite.
ALTER TABLE "lab_reports" ADD COLUMN "has_chosen_note_print" BOOLEAN NOT NULL DEFAULT false;

-- Backfill so nothing already printed changes:
--  * a report that already left something out keeps that choice;
--  * an approved or published report is frozen as it prints today (empty list = every section prints);
--  * every other report (still being worked on) has made no choice yet, so it follows the new default.
UPDATE "lab_reports"
SET "has_chosen_note_print" = true
WHERE cardinality("excluded_note_sections") > 0
   OR "status" IN ('APPROVED', 'PUBLISHED');
