-- Row-Level Security + partial unique index for radiology_certificates.
-- Tenant-scoped + branch-level master-data entity (no SiteAdmin/NULL-tenant rows).

ALTER TABLE radiology_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_certificates_tenant_isolation ON radiology_certificates;
CREATE POLICY radiology_certificates_tenant_isolation ON radiology_certificates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Unique certificate name per master data among ACTIVE (non-deleted) rows.
CREATE UNIQUE INDEX IF NOT EXISTS radiology_certificate_md_name_active_unique
  ON radiology_certificates (tenant_id, master_data_id, name) WHERE deleted_at IS NULL;
