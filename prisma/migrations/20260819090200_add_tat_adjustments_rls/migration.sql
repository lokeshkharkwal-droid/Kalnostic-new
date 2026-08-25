-- Row-Level Security for the new tat_adjustments table — mirrors the
-- tat_adjustments block added to prisma/rls.sql. Tenant-isolation policy keyed
-- on tenant_id (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS / FORCE), and runs
-- after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE tat_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tat_adjustments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tat_adjustments_tenant_isolation ON tat_adjustments;
CREATE POLICY tat_adjustments_tenant_isolation ON tat_adjustments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
