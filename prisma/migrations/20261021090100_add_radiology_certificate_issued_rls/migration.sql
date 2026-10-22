-- Row-Level Security for radiology_certificates_issued (tenant isolation).
ALTER TABLE "radiology_certificates_issued" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "radiology_certificates_issued" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_certificates_issued_tenant_isolation ON radiology_certificates_issued;
CREATE POLICY radiology_certificates_issued_tenant_isolation ON radiology_certificates_issued
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
