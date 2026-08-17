-- Row-Level Security for the new outsource_center_documents table — mirrors the
-- outsource_center_documents block added to prisma/rls.sql. Tenant-isolation
-- policy keyed on tenant_id (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS /
-- FORCE), and runs after 1_row_level_security so current_tenant_id() already
-- exists.
ALTER TABLE outsource_center_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_center_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outsource_center_documents_tenant_isolation ON outsource_center_documents;
CREATE POLICY outsource_center_documents_tenant_isolation ON outsource_center_documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
