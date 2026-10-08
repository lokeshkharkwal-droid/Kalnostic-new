-- Convert "Minimum Previous Dues to Clear" (Registration Settings → Charges &
-- Deductions) from a fixed amount to a percentage of the patient's outstanding
-- dues. The old Decimal amount and the new Int percent are not value-convertible,
-- so the column is dropped and re-added. DEFAULT 0 preserves the prior
-- "0 ⇒ require full clearance" semantics, so branches on the default are
-- unaffected.
ALTER TABLE "registration_settings"
  DROP COLUMN "charges_and_deductions_minimum_previous_dues_to_clear";

ALTER TABLE "registration_settings"
  ADD COLUMN "charges_and_deductions_minimum_previous_dues_percent_to_clear" INTEGER NOT NULL DEFAULT 0;
