-- Persist the selected privilege-card tier/name on the patient so the
-- registration form can restore the exact card the user picked (previously only
-- the `has_privilege_card` boolean + `privilege_number` were stored).
ALTER TABLE "patients" ADD COLUMN "privilege_card" TEXT;
