-- AlterEnum: add PATIENT and APPOINTMENT purposes (ORD/QUO/APT/PAT prefixes are
-- applied in the application layer, not the DB).
ALTER TYPE "ExternalIdPurpose" ADD VALUE IF NOT EXISTS 'APPOINTMENT';
ALTER TYPE "ExternalIdPurpose" ADD VALUE IF NOT EXISTS 'PATIENT';

-- AlterTable: per-entity auto-increment format dropdowns for appointment + patient.
ALTER TABLE "registration_settings"
  ADD COLUMN IF NOT EXISTS "appointment_auto_increment_ext_appt_id_format" "ExternalIdFormat" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "patients_auto_increment_ext_patient_id_format" "ExternalIdFormat" NOT NULL DEFAULT 'NONE';

-- AlterTable: user-facing external appointment id ("APT" + format).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_appointment_id" TEXT;

-- Globally-unique patient UMID across the whole DB (all tenants/branches), among
-- ACTIVE rows only. Prisma can't express a partial unique index, so it lives
-- here (mirrors patients_tenant_mobile_active_unique).
--
-- ⚠️ This build FAILS if two active patients already share a um_id. Resolve any
-- pre-existing duplicates before applying (e.g. NULL-out or re-key the losers):
--   -- inspect first:
--   -- SELECT um_id, count(*) FROM patients
--   -- WHERE um_id IS NOT NULL AND deleted_at IS NULL
--   -- GROUP BY um_id HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS patients_um_id_global_unique
  ON patients (um_id) WHERE um_id IS NOT NULL AND deleted_at IS NULL;
