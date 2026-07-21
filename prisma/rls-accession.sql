-- Accession module RLS policies (subset of prisma/rls.sql). Applied on its own
-- because the full rls.sql halts on the dropped `radiologists` table. Idempotent.

-- ── accession_samples ─────────────────────────────────────────────────────────
ALTER TABLE accession_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_samples_tenant_isolation ON accession_samples;
CREATE POLICY accession_samples_tenant_isolation ON accession_samples
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS accession_samples_tenant_accession_no_active_unique
  ON accession_samples (tenant_id, accession_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accession_samples_tenant_barcode_active_unique
  ON accession_samples (tenant_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

-- ── accession_sample_tests ────────────────────────────────────────────────────
ALTER TABLE accession_sample_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_sample_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_sample_tests_tenant_isolation ON accession_sample_tests;
CREATE POLICY accession_sample_tests_tenant_isolation ON accession_sample_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── accession_status_history ──────────────────────────────────────────────────
ALTER TABLE accession_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_status_history_tenant_isolation ON accession_status_history;
CREATE POLICY accession_status_history_tenant_isolation ON accession_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── sample_transfers ──────────────────────────────────────────────────────────
ALTER TABLE sample_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sample_transfers_tenant_isolation ON sample_transfers;
CREATE POLICY sample_transfers_tenant_isolation ON sample_transfers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── accession_settings ────────────────────────────────────────────────────────
ALTER TABLE accession_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_settings_tenant_isolation ON accession_settings;
CREATE POLICY accession_settings_tenant_isolation ON accession_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
