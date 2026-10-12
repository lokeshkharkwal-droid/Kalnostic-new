-- Makes the patient mobile number optional for B2B orders, gated by a new
-- registration setting.
--
-- 1. `registration_settings.patients_allow_b2b_patient_without_mobile`
--    (default false = existing behaviour): when enabled, the Create-Order
--    frontend lets a B2B order (one with a referral panel attached) register a
--    patient without a mobile. Non-B2B orders are unaffected.
--
-- 2. `patients.mobile` becomes NULLABLE so such patients can be stored. The app
--    writes NULL (never "") when the number is unknown — "" would collide on the
--    partial unique index `patients_tenant_mobile_active_unique`, whereas NULLs
--    are treated as distinct by Postgres, so the index needs no change.

ALTER TABLE "registration_settings"
  ADD COLUMN "patients_allow_b2b_patient_without_mobile" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "patients" ALTER COLUMN "mobile" DROP NOT NULL;
