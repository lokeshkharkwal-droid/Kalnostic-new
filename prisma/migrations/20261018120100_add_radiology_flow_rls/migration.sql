-- Radiology (New Radiology Flow) — RLS policies + partial unique indexes + CHECKs
-- for the parallel radiology catalogue + processing tree. Idempotent (mirrors the
-- radiology block in prisma/rls.sql): safe to re-run.

-- ── radiology_tests ───────────────────────────────────────────────────────────
ALTER TABLE radiology_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_tests_tenant_isolation ON radiology_tests;
CREATE POLICY radiology_tests_tenant_isolation ON radiology_tests
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );
CREATE UNIQUE INDEX IF NOT EXISTS radiology_test_md_name_active_unique
  ON radiology_tests (tenant_id, master_data_id, test_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS radiology_test_md_code_active_unique
  ON radiology_tests (tenant_id, master_data_id, test_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS radiology_test_siteadmin_name_active_unique
  ON radiology_tests (test_name) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS radiology_test_siteadmin_code_active_unique
  ON radiology_tests (test_code) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
ALTER TABLE radiology_tests DROP CONSTRAINT IF EXISTS chk_radiology_test_price_max_lte_msrp;
ALTER TABLE radiology_tests ADD CONSTRAINT chk_radiology_test_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE radiology_tests DROP CONSTRAINT IF EXISTS chk_radiology_test_price_min_lte_max;
ALTER TABLE radiology_tests ADD CONSTRAINT chk_radiology_test_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE radiology_tests DROP CONSTRAINT IF EXISTS chk_radiology_test_discount_cap_range;
ALTER TABLE radiology_tests ADD CONSTRAINT chk_radiology_test_discount_cap_range
  CHECK (discount_cap_pct BETWEEN 0 AND 100);

-- ── radiology_panels ──────────────────────────────────────────────────────────
ALTER TABLE radiology_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_panels_tenant_isolation ON radiology_panels;
CREATE POLICY radiology_panels_tenant_isolation ON radiology_panels
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );
CREATE UNIQUE INDEX IF NOT EXISTS radiology_panel_md_name_active_unique
  ON radiology_panels (tenant_id, master_data_id, panel_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS radiology_panel_md_code_active_unique
  ON radiology_panels (tenant_id, master_data_id, panel_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS radiology_panel_siteadmin_name_active_unique
  ON radiology_panels (panel_name) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS radiology_panel_siteadmin_code_active_unique
  ON radiology_panels (panel_code) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
ALTER TABLE radiology_panels DROP CONSTRAINT IF EXISTS chk_radiology_panel_price_max_lte_msrp;
ALTER TABLE radiology_panels ADD CONSTRAINT chk_radiology_panel_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE radiology_panels DROP CONSTRAINT IF EXISTS chk_radiology_panel_price_min_lte_max;
ALTER TABLE radiology_panels ADD CONSTRAINT chk_radiology_panel_price_min_lte_max
  CHECK (price_minimum <= price_maximum);

-- ── radiology_panel_tests ─────────────────────────────────────────────────────
ALTER TABLE radiology_panel_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_panel_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_panel_tests_tenant_isolation ON radiology_panel_tests;
CREATE POLICY radiology_panel_tests_tenant_isolation ON radiology_panel_tests
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );
CREATE UNIQUE INDEX IF NOT EXISTS radiology_panel_test_active_unique
  ON radiology_panel_tests (radiology_panel_id, radiology_test_id) WHERE deleted_at IS NULL;

-- ── branch_radiology_tests ────────────────────────────────────────────────────
ALTER TABLE branch_radiology_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_radiology_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_radiology_tests_tenant_isolation ON branch_radiology_tests;
CREATE POLICY branch_radiology_tests_tenant_isolation ON branch_radiology_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_test_default_per_source_unique
  ON branch_radiology_tests (tenant_id, branch_id, list_id, source_radiology_test_id)
  WHERE is_default AND deleted_at IS NULL;
ALTER TABLE branch_radiology_tests DROP CONSTRAINT IF EXISTS chk_branch_radiology_test_price_max_lte_msrp;
ALTER TABLE branch_radiology_tests ADD CONSTRAINT chk_branch_radiology_test_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE branch_radiology_tests DROP CONSTRAINT IF EXISTS chk_branch_radiology_test_price_min_lte_max;
ALTER TABLE branch_radiology_tests ADD CONSTRAINT chk_branch_radiology_test_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE branch_radiology_tests DROP CONSTRAINT IF EXISTS chk_branch_radiology_test_discount_cap_range;
ALTER TABLE branch_radiology_tests ADD CONSTRAINT chk_branch_radiology_test_discount_cap_range
  CHECK (discount_cap_pct BETWEEN 0 AND 100);

-- ── branch_radiology_test_lists ───────────────────────────────────────────────
ALTER TABLE branch_radiology_test_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_radiology_test_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_radiology_test_lists_tenant_isolation ON branch_radiology_test_lists;
CREATE POLICY branch_radiology_test_lists_tenant_isolation ON branch_radiology_test_lists
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_test_list_name_active_unique
  ON branch_radiology_test_lists (tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_test_list_default_active_unique
  ON branch_radiology_test_lists (tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL;

-- ── branch_radiology_panels ───────────────────────────────────────────────────
ALTER TABLE branch_radiology_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_radiology_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_radiology_panels_tenant_isolation ON branch_radiology_panels;
CREATE POLICY branch_radiology_panels_tenant_isolation ON branch_radiology_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_panel_default_per_source_unique
  ON branch_radiology_panels (tenant_id, branch_id, list_id, source_radiology_panel_id)
  WHERE is_default AND deleted_at IS NULL;
ALTER TABLE branch_radiology_panels DROP CONSTRAINT IF EXISTS chk_branch_radiology_panel_price_max_lte_msrp;
ALTER TABLE branch_radiology_panels ADD CONSTRAINT chk_branch_radiology_panel_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE branch_radiology_panels DROP CONSTRAINT IF EXISTS chk_branch_radiology_panel_price_min_lte_max;
ALTER TABLE branch_radiology_panels ADD CONSTRAINT chk_branch_radiology_panel_price_min_lte_max
  CHECK (price_minimum <= price_maximum);

-- ── branch_radiology_panel_tests ──────────────────────────────────────────────
ALTER TABLE branch_radiology_panel_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_radiology_panel_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_radiology_panel_tests_tenant_isolation ON branch_radiology_panel_tests;
CREATE POLICY branch_radiology_panel_tests_tenant_isolation ON branch_radiology_panel_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_panel_test_active_unique
  ON branch_radiology_panel_tests (tenant_id, branch_radiology_panel_id, branch_radiology_test_id)
  WHERE deleted_at IS NULL;

-- ── branch_radiology_panel_lists ──────────────────────────────────────────────
ALTER TABLE branch_radiology_panel_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_radiology_panel_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_radiology_panel_lists_tenant_isolation ON branch_radiology_panel_lists;
CREATE POLICY branch_radiology_panel_lists_tenant_isolation ON branch_radiology_panel_lists
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_panel_list_name_active_unique
  ON branch_radiology_panel_lists (tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS branch_radiology_panel_list_default_active_unique
  ON branch_radiology_panel_lists (tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL;

-- ── radiology_reporting_doctors ───────────────────────────────────────────────
ALTER TABLE radiology_reporting_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_reporting_doctors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_reporting_doctors_tenant_isolation ON radiology_reporting_doctors;
CREATE POLICY radiology_reporting_doctors_tenant_isolation ON radiology_reporting_doctors
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS radiology_reporting_doctor_regno_active_unique
  ON radiology_reporting_doctors (tenant_id, registration_no) WHERE deleted_at IS NULL;

-- ── radiology_outsource_centers ───────────────────────────────────────────────
ALTER TABLE radiology_outsource_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_outsource_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_outsource_centers_tenant_isolation ON radiology_outsource_centers;
CREATE POLICY radiology_outsource_centers_tenant_isolation ON radiology_outsource_centers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS radiology_outsource_center_name_active_unique
  ON radiology_outsource_centers (tenant_id, center_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS radiology_outsource_center_code_active_unique
  ON radiology_outsource_centers (tenant_id, code) WHERE deleted_at IS NULL;

-- ── radiology_studies ─────────────────────────────────────────────────────────
ALTER TABLE radiology_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_studies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_studies_tenant_isolation ON radiology_studies;
CREATE POLICY radiology_studies_tenant_isolation ON radiology_studies
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX IF NOT EXISTS radiology_studies_tenant_study_no_active_unique
  ON radiology_studies (tenant_id, study_no) WHERE deleted_at IS NULL;

-- ── radiology_study_status_history ────────────────────────────────────────────
ALTER TABLE radiology_study_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_study_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_study_status_history_tenant_isolation ON radiology_study_status_history;
CREATE POLICY radiology_study_status_history_tenant_isolation ON radiology_study_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── radiology_settings ────────────────────────────────────────────────────────
ALTER TABLE radiology_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiology_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiology_settings_tenant_isolation ON radiology_settings;
CREATE POLICY radiology_settings_tenant_isolation ON radiology_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
