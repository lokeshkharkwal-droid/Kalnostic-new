-- Row-Level Security for the new patient_documents table — mirrors the
-- patient_documents block added to prisma/rls.sql. Tenant-isolation policy keyed
-- on tenant_id (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS / FORCE), and runs
-- after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patient_documents_tenant_isolation ON patient_documents;
CREATE POLICY patient_documents_tenant_isolation ON patient_documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
