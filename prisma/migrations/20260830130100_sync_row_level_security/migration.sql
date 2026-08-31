-- Re-point RLS policies + partial unique indexes onto the renamed order-sample
-- tables (source of truth: prisma/rls.sql). Idempotent (DROP IF EXISTS / CREATE
-- IF NOT EXISTS / FORCE), so re-running is safe. The ENABLE/FORCE + policies
-- were carried over from the old table names by the rename in the previous
-- migration; here we drop the stale-named policies/indexes and recreate them
-- with the new names.

-- ── Drop the policies + partial unique indexes carried over from old names ──
DROP POLICY IF EXISTS "accession_samples_tenant_isolation" ON "order_samples";
DROP POLICY IF EXISTS "accession_sample_tests_tenant_isolation" ON "order_sample_tests";
DROP POLICY IF EXISTS "accession_status_history_tenant_isolation" ON "order_sample_status_history";
DROP INDEX IF EXISTS "accession_samples_tenant_accession_no_active_unique";
DROP INDEX IF EXISTS "accession_samples_tenant_barcode_active_unique";

-- ── order_samples ───────────────────────────────────────────────────────────
ALTER TABLE order_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_samples_tenant_isolation ON order_samples;
CREATE POLICY order_samples_tenant_isolation ON order_samples
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE UNIQUE INDEX IF NOT EXISTS order_samples_tenant_accession_no_active_unique
  ON order_samples (tenant_id, accession_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_samples_tenant_barcode_active_unique
  ON order_samples (tenant_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

-- ── order_sample_tests ──────────────────────────────────────────────────────
ALTER TABLE order_sample_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sample_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_sample_tests_tenant_isolation ON order_sample_tests;
CREATE POLICY order_sample_tests_tenant_isolation ON order_sample_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── order_sample_status_history ─────────────────────────────────────────────
ALTER TABLE order_sample_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sample_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_sample_status_history_tenant_isolation ON order_sample_status_history;
CREATE POLICY order_sample_status_history_tenant_isolation ON order_sample_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
