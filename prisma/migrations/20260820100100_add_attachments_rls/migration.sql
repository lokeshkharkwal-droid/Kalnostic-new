-- Row-Level Security for the new attachments table — mirrors the attachments
-- block added to prisma/rls.sql. Tenant-isolation policy keyed on tenant_id
-- (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS / FORCE), and runs after
-- 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attachments_tenant_isolation ON attachments;
CREATE POLICY attachments_tenant_isolation ON attachments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
