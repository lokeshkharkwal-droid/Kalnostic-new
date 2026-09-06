-- Row-Level Security for the new print_template_images table — mirrors the
-- print_template_images block added to prisma/rls.sql. Tenant rows isolate by
-- tenant_id; SITE_ADMIN global-template images (tenant_id NULL) are readable by
-- everyone and writable only by a GUC-less SiteAdmin connection (mirrors the
-- pdf_report_templates pattern, CLAUDE.md §4.3). Idempotent (DROP IF EXISTS /
-- FORCE), and runs after 1_row_level_security so current_tenant_id() exists.
ALTER TABLE print_template_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_template_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pti_tenant_isolation ON print_template_images;
CREATE POLICY pti_tenant_isolation ON print_template_images
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );
