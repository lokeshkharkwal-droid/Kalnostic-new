-- Partial unique indexes for the new EzHealthTrack legacy-id columns (source of
-- truth: prisma/rls.sql). Prisma can't express partial unique indexes, so they
-- live in rls.sql and are mirrored here. Idempotent (CREATE ... IF NOT EXISTS),
-- so re-running the file is safe.
--
-- Each enforces per-tenant uniqueness of the legacy id among ACTIVE rows that
-- actually carry one, which is what makes the data migration idempotent: a re-run
-- resolves the existing row by (tenant_id, legacy id) instead of duplicating it.

CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_legacy_id_active_unique
  ON branches (tenant_id, legacy_branch_id) WHERE deleted_at IS NULL AND legacy_branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_legacy_id_active_unique
  ON patients (tenant_id, legacy_patient_id) WHERE deleted_at IS NULL AND legacy_patient_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referral_panels_tenant_legacy_id_active_unique
  ON referral_panels (tenant_id, legacy_id) WHERE deleted_at IS NULL AND legacy_id IS NOT NULL;
