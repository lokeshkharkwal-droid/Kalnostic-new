-- Replace the unit-blind `age_from <= age_to` CHECKs on reference ranges / values.
--
-- Why: `age_from` and `age_to` each carry their own unit (DAYS / MONTHS / YEARS).
-- The old constraint compared the raw numbers, so a valid range such as
-- "15 Days to 1 Year" (15 > 1) was rejected by the database. The exact rule
-- (calendar-based, "To" covers its whole unit) is enforced in the application
-- (`age-bounds.util.ts`, called by LabTestService); this constraint is only a
-- conservative safety net that can never reject a range the application accepts:
--   lowest possible length of the From bound  (day = 1, month >= 28, year >= 365)
--   must be below the highest possible length of the To bound + 1 unit
--   (day = 1, month <= 31, year <= 366).
--
-- NOT VALID: the constraint is enforced for new / updated rows only and existing
-- rows (including soft-deleted ones) are not scanned, so this migration cannot
-- fail on existing data and changes no rows.
--
-- Rollback (restores the previous definition):
--   ALTER TABLE lab_test_reference_ranges DROP CONSTRAINT chk_ref_range_age;
--   ALTER TABLE lab_test_reference_ranges ADD CONSTRAINT chk_ref_range_age CHECK (age_from <= age_to);
--   ALTER TABLE lab_test_reference_values DROP CONSTRAINT chk_ref_value_age;
--   ALTER TABLE lab_test_reference_values ADD CONSTRAINT chk_ref_value_age CHECK (age_from <= age_to);

ALTER TABLE "lab_test_reference_ranges" DROP CONSTRAINT IF EXISTS "chk_ref_range_age";
ALTER TABLE "lab_test_reference_ranges" ADD CONSTRAINT "chk_ref_range_age"
  CHECK (
    age_from * (CASE age_from_unit WHEN 'DAYS' THEN 1 WHEN 'MONTHS' THEN 28 ELSE 365 END)
    < (age_to + 1) * (CASE age_to_unit WHEN 'DAYS' THEN 1 WHEN 'MONTHS' THEN 31 ELSE 366 END)
  ) NOT VALID;

ALTER TABLE "lab_test_reference_values" DROP CONSTRAINT IF EXISTS "chk_ref_value_age";
ALTER TABLE "lab_test_reference_values" ADD CONSTRAINT "chk_ref_value_age"
  CHECK (
    age_from * (CASE age_from_unit WHEN 'DAYS' THEN 1 WHEN 'MONTHS' THEN 28 ELSE 365 END)
    < (age_to + 1) * (CASE age_to_unit WHEN 'DAYS' THEN 1 WHEN 'MONTHS' THEN 31 ELSE 366 END)
  ) NOT VALID;
