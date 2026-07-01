-- Row-Level Security policies for tenant-scoped tables (CLAUDE.md §4.3).
--
-- Apply AFTER the Prisma schema is migrated (e.g. `prisma migrate deploy`):
--   psql "$DATABASE_URL" -f prisma/rls.sql
--
-- The application sets the current tenant per request via
-- `set_config('app.current_tenant_id', <uuid>, true)` inside a transaction
-- (see PrismaService.withTenant). Each policy restricts rows to that tenant.
--
-- NOTE: the DB role used by the app must NOT have the BYPASSRLS attribute and
-- must NOT be the table owner (owners bypass RLS by default). Create a dedicated
-- least-privilege role for the application connection.

-- Helper: read the current tenant from the session, NULL if unset.
--
-- Returns TEXT (not uuid): tenant_id columns are Prisma `String` → Postgres
-- `text` (the schema does not use `@db.Uuid`), so the policies compare
-- `tenant_id = current_tenant_id()` as text = text. `DROP ... CASCADE` is
-- required because Postgres can't change a function's return type in-place;
-- the policies it drops are all re-created below, so the script stays idempotent.
DROP FUNCTION IF EXISTS current_tenant_id() CASCADE;
CREATE FUNCTION current_tenant_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '');
$$ LANGUAGE sql STABLE;

-- ── branches ──────────────────────────────────────────────────────────────────
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branches_tenant_isolation ON branches;
CREATE POLICY branches_tenant_isolation ON branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant uniqueness for branch name + code, among ACTIVE rows only
-- (partial index on deleted_at IS NULL), so a name/code freed by a soft-delete
-- can be reused. `code` is system-generated & immutable; `name` is user-set.
-- Prisma can't express partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_code_active_unique
  ON branches (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_name_active_unique
  ON branches (tenant_id, name) WHERE deleted_at IS NULL;

-- ── tenant_main_branch ──────────────────────────────────────────────────────────
ALTER TABLE tenant_main_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_main_branch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmb_tenant_isolation ON tenant_main_branch;
CREATE POLICY tmb_tenant_isolation ON tenant_main_branch
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── schedules ─────────────────────────────────────────────────────────────────
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedules_tenant_isolation ON schedules;
CREATE POLICY schedules_tenant_isolation ON schedules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── user_branch_profiles ────────────────────────────────────────────────────────
ALTER TABLE user_branch_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ubp_tenant_isolation ON user_branch_profiles;
CREATE POLICY ubp_tenant_isolation ON user_branch_profiles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One active role per (tenant, person, branch): a user holds at most one role at a
-- given branch (different roles allowed across branches). NULL branch_id rows
-- (tenant-level profiles) are treated as distinct by Postgres, so they are not
-- constrained here. Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS ubp_person_branch_active_unique
  ON user_branch_profiles (tenant_id, person_id, branch_id)
  WHERE deleted_at IS NULL AND is_active = true;

-- ── user_profile_permission_overrides ───────────────────────────────────────────
ALTER TABLE user_profile_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile_permission_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uppo_tenant_isolation ON user_profile_permission_overrides;
CREATE POLICY uppo_tenant_isolation ON user_profile_permission_overrides
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── receptionist_doctor_mappings ─────────────────────────────────────────────────
ALTER TABLE receptionist_doctor_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptionist_doctor_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rdm_tenant_isolation ON receptionist_doctor_mappings;
CREATE POLICY rdm_tenant_isolation ON receptionist_doctor_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── departments ─────────────────────────────────────────────────────────────────
-- Tenant rows isolate by tenant_id; SITE_ADMIN global templates (tenant_id NULL)
-- are readable by everyone and writable only by a GUC-less SiteAdmin connection
-- (current_tenant_id() NULL), mirroring lab_test / lab_panels.
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
CREATE POLICY departments_tenant_isolation ON departments
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Per-tenant uniqueness for department name + code, among ACTIVE rows only
-- (partial index on deleted_at IS NULL), so a name/code freed by a soft-delete
-- can be reused. `code` is system-generated & immutable; `name` is user-set.
-- Prisma can't express partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_code_active_unique
  ON departments (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_name_active_unique
  ON departments (tenant_id, name) WHERE deleted_at IS NULL;

-- User-set `short_name` (dropdown prefix): unique per tenant among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_short_name_active_unique
  ON departments (tenant_id, short_name) WHERE deleted_at IS NULL;

-- SITE_ADMIN templates have tenant_id NULL; Postgres treats NULLs as distinct,
-- so the per-tenant indexes above don't constrain them. These enforce global
-- uniqueness of code / name / short_name across ACTIVE template rows.
CREATE UNIQUE INDEX IF NOT EXISTS departments_template_code_active_unique
  ON departments (code) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_template_name_active_unique
  ON departments (name) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_template_short_name_active_unique
  ON departments (short_name) WHERE deleted_at IS NULL AND tenant_id IS NULL;

-- ── department_person_mappings ────────────────────────────────────────────────────
ALTER TABLE department_person_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_person_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dpm_tenant_isolation ON department_person_mappings;
CREATE POLICY dpm_tenant_isolation ON department_person_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── categories ──────────────────────────────────────────────────────────────────
-- Tenant rows isolate by tenant_id; SITE_ADMIN global templates (tenant_id NULL)
-- are readable by everyone and writable only by a GUC-less SiteAdmin connection.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_tenant_isolation ON categories;
CREATE POLICY categories_tenant_isolation ON categories
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Per-tenant uniqueness for category name + code, among ACTIVE rows only
-- (partial index on deleted_at IS NULL), mirroring departments. `code` is
-- system-generated & immutable; `name` is user-set. Prisma can't express
-- partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_code_active_unique
  ON categories (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_active_unique
  ON categories (tenant_id, name) WHERE deleted_at IS NULL;

-- User-set `short_name` (dropdown prefix), among ACTIVE rows. Scoped to the
-- parent department for UNDER_DEPARTMENT categories (department_id NOT NULL), so
-- two different departments may reuse the same short name; INDEPENDENT
-- categories (department_id NULL) are unique per tenant. Postgres treats NULLs
-- as distinct, so the two cases need separate partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS categories_dept_short_name_active_unique
  ON categories (tenant_id, department_id, short_name)
  WHERE deleted_at IS NULL AND department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_independent_short_name_active_unique
  ON categories (tenant_id, short_name)
  WHERE deleted_at IS NULL AND department_id IS NULL;

-- SITE_ADMIN templates (tenant_id NULL): global uniqueness of code / name, and
-- short_name scoped to the template parent department (UNDER_DEPARTMENT) or
-- global for INDEPENDENT — mirroring the per-tenant indexes above with the
-- tenant_id IS NULL predicate (NULLs are distinct, so they need their own).
CREATE UNIQUE INDEX IF NOT EXISTS categories_template_code_active_unique
  ON categories (code) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_template_name_active_unique
  ON categories (name) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_template_dept_short_name_active_unique
  ON categories (department_id, short_name)
  WHERE deleted_at IS NULL AND tenant_id IS NULL AND department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_template_independent_short_name_active_unique
  ON categories (short_name)
  WHERE deleted_at IS NULL AND tenant_id IS NULL AND department_id IS NULL;

-- Invariant: UNDER_DEPARTMENT ⇒ department_id set; INDEPENDENT ⇒ NULL. Prisma
-- can't express a conditional constraint, so it lives here (defence in depth on
-- top of the DTO + CategoryService checks).
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_type_dept_chk;
ALTER TABLE categories ADD CONSTRAINT categories_type_dept_chk CHECK (
  (category_type = 'UNDER_DEPARTMENT' AND department_id IS NOT NULL) OR
  (category_type = 'INDEPENDENT' AND department_id IS NULL)
);

-- ── category_person_mappings ──────────────────────────────────────────────────────
ALTER TABLE category_person_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_person_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpm_tenant_isolation ON category_person_mappings;
CREATE POLICY cpm_tenant_isolation ON category_person_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── sub_categories ──────────────────────────────────────────────────────────────
-- Tenant rows isolate by tenant_id; SITE_ADMIN global templates (tenant_id NULL)
-- are readable by everyone and writable only by a GUC-less SiteAdmin connection.
ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_categories_tenant_isolation ON sub_categories;
CREATE POLICY sub_categories_tenant_isolation ON sub_categories
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Per-tenant uniqueness for sub-category name + code, among ACTIVE rows only
-- (partial index on deleted_at IS NULL), mirroring categories. `code` is
-- system-generated & immutable; `name` is user-set. Prisma can't express
-- partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_tenant_code_active_unique
  ON sub_categories (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_tenant_name_active_unique
  ON sub_categories (tenant_id, name) WHERE deleted_at IS NULL;

-- User-set `short_name` (dropdown prefix), among ACTIVE rows. Scoped to the
-- parent category for UNDER_CATEGORY rows (category_id NOT NULL), to the parent
-- department for UNDER_DEPARTMENT rows (department_id NOT NULL), and per tenant
-- for INDEPENDENT rows (both NULL). Postgres treats NULLs as distinct, so each
-- type needs its own partial index.
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_cat_short_name_active_unique
  ON sub_categories (tenant_id, category_id, short_name)
  WHERE deleted_at IS NULL AND category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_dept_short_name_active_unique
  ON sub_categories (tenant_id, department_id, short_name)
  WHERE deleted_at IS NULL AND department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_independent_short_name_active_unique
  ON sub_categories (tenant_id, short_name)
  WHERE deleted_at IS NULL AND department_id IS NULL AND category_id IS NULL;

-- SITE_ADMIN templates (tenant_id NULL): global uniqueness of code / name, and
-- short_name scoped to the template parent category (UNDER_CATEGORY), parent
-- department (UNDER_DEPARTMENT), or global for INDEPENDENT — mirroring the
-- per-tenant indexes above with the tenant_id IS NULL predicate.
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_template_code_active_unique
  ON sub_categories (code) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_template_name_active_unique
  ON sub_categories (name) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_template_cat_short_name_active_unique
  ON sub_categories (category_id, short_name)
  WHERE deleted_at IS NULL AND tenant_id IS NULL AND category_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_template_dept_short_name_active_unique
  ON sub_categories (department_id, short_name)
  WHERE deleted_at IS NULL AND tenant_id IS NULL AND department_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sub_categories_template_independent_short_name_active_unique
  ON sub_categories (short_name)
  WHERE deleted_at IS NULL AND tenant_id IS NULL AND department_id IS NULL AND category_id IS NULL;

-- Invariant: UNDER_DEPARTMENT ⇒ department_id set (category_id NULL);
-- UNDER_CATEGORY ⇒ category_id set (department_id NULL); INDEPENDENT ⇒ both
-- NULL. Prisma can't express a conditional constraint, so it lives here
-- (defence in depth on top of the DTO + SubCategoryService checks).
ALTER TABLE sub_categories DROP CONSTRAINT IF EXISTS sub_categories_type_parent_chk;
ALTER TABLE sub_categories ADD CONSTRAINT sub_categories_type_parent_chk CHECK (
  (sub_category_type = 'UNDER_DEPARTMENT' AND department_id IS NOT NULL AND category_id IS NULL) OR
  (sub_category_type = 'UNDER_CATEGORY'   AND category_id   IS NOT NULL AND department_id IS NULL) OR
  (sub_category_type = 'INDEPENDENT'      AND department_id IS NULL     AND category_id IS NULL)
);

-- ── sub_category_person_mappings ──────────────────────────────────────────────────
ALTER TABLE sub_category_person_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_category_person_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scpm_tenant_isolation ON sub_category_person_mappings;
CREATE POLICY scpm_tenant_isolation ON sub_category_person_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── audit_logs ────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── master_data ─────────────────────────────────────────────────────────────────
ALTER TABLE master_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_data FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS md_tenant_isolation ON master_data;
CREATE POLICY md_tenant_isolation ON master_data
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Master-data `name` is unique per branch among ACTIVE rows only (a name freed by
-- a soft-delete can be reused). Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS master_data_branch_name_active_unique
  ON master_data (tenant_id, branch_id, name) WHERE deleted_at IS NULL;

-- A branch maps to exactly ONE active master data (1:1). Enforced among ACTIVE
-- rows only, so a branch whose master data is soft-deleted can be re-provisioned.
CREATE UNIQUE INDEX IF NOT EXISTS master_data_branch_active_unique
  ON master_data (branch_id) WHERE deleted_at IS NULL;

-- ── lab_test ────────────────────────────────────────────────────────────────────
ALTER TABLE lab_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_tenant_isolation ON lab_test;
CREATE POLICY lab_test_tenant_isolation ON lab_test
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- `test_name` / `test_code` unique per master data among ACTIVE rows only (a value
-- freed by a soft-delete can be reused). Per master data (not tenant) so cloning a
-- test into another branch's master data is allowed. Prisma can't express these.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_md_name_active_unique
  ON lab_test (tenant_id, master_data_id, test_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_md_code_active_unique
  ON lab_test (tenant_id, master_data_id, test_code) WHERE deleted_at IS NULL;

-- SITE_ADMIN global templates have NULL tenant_id/master_data_id, so the
-- per-master-data indexes above don't constrain them (NULLs are distinct). These
-- enforce unique name/code across the SITE_ADMIN template catalogue.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_siteadmin_name_active_unique
  ON lab_test (test_name) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_siteadmin_code_active_unique
  ON lab_test (test_code) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';

-- CHECK constraints (Prisma can't express them); defence in depth on top of the
-- DTO + LabTestService validation.
ALTER TABLE lab_test DROP CONSTRAINT IF EXISTS chk_lab_test_price_max_lte_msrp;
ALTER TABLE lab_test ADD CONSTRAINT chk_lab_test_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE lab_test DROP CONSTRAINT IF EXISTS chk_lab_test_price_min_lte_max;
ALTER TABLE lab_test ADD CONSTRAINT chk_lab_test_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE lab_test DROP CONSTRAINT IF EXISTS chk_lab_test_discount_cap_range;
ALTER TABLE lab_test ADD CONSTRAINT chk_lab_test_discount_cap_range
  CHECK (discount_cap_pct BETWEEN 0 AND 100);
ALTER TABLE lab_test DROP CONSTRAINT IF EXISTS chk_lab_test_mandatory_fields;
ALTER TABLE lab_test ADD CONSTRAINT chk_lab_test_mandatory_fields
  CHECK (is_mandatory_test = FALSE OR mandatory_dept_id IS NOT NULL);
ALTER TABLE lab_test DROP CONSTRAINT IF EXISTS chk_lab_test_repeat_fields;
ALTER TABLE lab_test ADD CONSTRAINT chk_lab_test_repeat_fields
  CHECK (
    is_repeat_interval_restriction = FALSE OR
    (repeat_interval_value IS NOT NULL AND repeat_interval_unit IS NOT NULL)
  );

-- ── lab_test_samples ────────────────────────────────────────────────────────────
ALTER TABLE lab_test_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_samples_tenant_isolation ON lab_test_samples;
CREATE POLICY lab_test_samples_tenant_isolation ON lab_test_samples
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- At most one default sample per test among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_sample_default_active_unique
  ON lab_test_samples (tenant_id, lab_test_id)
  WHERE is_default = TRUE AND deleted_at IS NULL;
-- Same rule for SITE_ADMIN template samples (NULL tenant_id).
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_sample_default_siteadmin_unique
  ON lab_test_samples (lab_test_id)
  WHERE is_default = TRUE AND deleted_at IS NULL AND tenant_id IS NULL;

ALTER TABLE lab_test_samples DROP CONSTRAINT IF EXISTS chk_lab_test_sample_number;
ALTER TABLE lab_test_samples ADD CONSTRAINT chk_lab_test_sample_number
  CHECK (number_of_samples >= 1);

-- ── lab_test_result_params ──────────────────────────────────────────────────────
ALTER TABLE lab_test_result_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_result_params FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_result_params_tenant_isolation ON lab_test_result_params;
CREATE POLICY lab_test_result_params_tenant_isolation ON lab_test_result_params
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- `parameter_code` unique per test among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_param_code_active_unique
  ON lab_test_result_params (tenant_id, lab_test_id, parameter_code) WHERE deleted_at IS NULL;
-- Same rule for SITE_ADMIN template params (NULL tenant_id).
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_param_code_siteadmin_unique
  ON lab_test_result_params (lab_test_id, parameter_code)
  WHERE deleted_at IS NULL AND tenant_id IS NULL;

ALTER TABLE lab_test_result_params DROP CONSTRAINT IF EXISTS chk_lab_test_param_calc_formula;
ALTER TABLE lab_test_result_params ADD CONSTRAINT chk_lab_test_param_calc_formula
  CHECK (parameter_type != 'CALCULATED' OR calculation_formula IS NOT NULL);
ALTER TABLE lab_test_result_params DROP CONSTRAINT IF EXISTS chk_lab_test_param_decimals;
ALTER TABLE lab_test_result_params ADD CONSTRAINT chk_lab_test_param_decimals
  CHECK (decimal_places BETWEEN 0 AND 6);
ALTER TABLE lab_test_result_params DROP CONSTRAINT IF EXISTS chk_lab_test_param_critical_minmax;
ALTER TABLE lab_test_result_params ADD CONSTRAINT chk_lab_test_param_critical_minmax
  CHECK (critical_min IS NULL OR critical_max IS NULL OR critical_min <= critical_max);

-- ── lab_test_reference_ranges ─────────────────────────────────────────────────────
ALTER TABLE lab_test_reference_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_reference_ranges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_reference_ranges_tenant_isolation ON lab_test_reference_ranges;
CREATE POLICY lab_test_reference_ranges_tenant_isolation ON lab_test_reference_ranges
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

ALTER TABLE lab_test_reference_ranges DROP CONSTRAINT IF EXISTS chk_ref_range_lower_lte_upper;
ALTER TABLE lab_test_reference_ranges ADD CONSTRAINT chk_ref_range_lower_lte_upper
  CHECK (lower_limit IS NULL OR upper_limit IS NULL OR lower_limit <= upper_limit);
ALTER TABLE lab_test_reference_ranges DROP CONSTRAINT IF EXISTS chk_ref_range_critical_min;
ALTER TABLE lab_test_reference_ranges ADD CONSTRAINT chk_ref_range_critical_min
  CHECK (critical_min IS NULL OR lower_limit IS NULL OR critical_min <= lower_limit);
ALTER TABLE lab_test_reference_ranges DROP CONSTRAINT IF EXISTS chk_ref_range_critical_max;
ALTER TABLE lab_test_reference_ranges ADD CONSTRAINT chk_ref_range_critical_max
  CHECK (critical_max IS NULL OR upper_limit IS NULL OR critical_max >= upper_limit);
ALTER TABLE lab_test_reference_ranges DROP CONSTRAINT IF EXISTS chk_ref_range_age;
ALTER TABLE lab_test_reference_ranges ADD CONSTRAINT chk_ref_range_age
  CHECK (age_from <= age_to);

-- ── lab_test_reference_values ─────────────────────────────────────────────────────
ALTER TABLE lab_test_reference_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_reference_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_reference_values_tenant_isolation ON lab_test_reference_values;
CREATE POLICY lab_test_reference_values_tenant_isolation ON lab_test_reference_values
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

ALTER TABLE lab_test_reference_values DROP CONSTRAINT IF EXISTS chk_ref_value_age;
ALTER TABLE lab_test_reference_values ADD CONSTRAINT chk_ref_value_age
  CHECK (age_from <= age_to);

-- ── lab_panels ──────────────────────────────────────────────────────────────────
ALTER TABLE lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_panels_tenant_isolation ON lab_panels;
CREATE POLICY lab_panels_tenant_isolation ON lab_panels
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- `panel_name` / `panel_code` unique per master data among ACTIVE rows only (a
-- value freed by a soft-delete can be reused). Per master data (not tenant), like
-- lab_test. Prisma can't express these.
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_md_name_active_unique
  ON lab_panels (tenant_id, master_data_id, panel_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_md_code_active_unique
  ON lab_panels (tenant_id, master_data_id, panel_code) WHERE deleted_at IS NULL;

-- SITE_ADMIN global templates (NULL tenant_id/master_data_id): unique name/code
-- across the template catalogue, mirroring lab_test.
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_siteadmin_name_active_unique
  ON lab_panels (panel_name) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_siteadmin_code_active_unique
  ON lab_panels (panel_code) WHERE deleted_at IS NULL AND source = 'SITE_ADMIN';

-- CHECK constraints (Prisma can't express them); defence in depth on top of the
-- DTO + LabPanelService validation.
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS chk_lab_panel_price_max_lte_msrp;
ALTER TABLE lab_panels ADD CONSTRAINT chk_lab_panel_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS chk_lab_panel_price_min_lte_max;
ALTER TABLE lab_panels ADD CONSTRAINT chk_lab_panel_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS chk_lab_panel_max_removable_nonneg;
ALTER TABLE lab_panels ADD CONSTRAINT chk_lab_panel_max_removable_nonneg
  CHECK (max_tests_removable >= 0);
-- max_tests_removable > 0 only makes sense when partial billing is allowed.
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS chk_lab_panel_removable_partial;
ALTER TABLE lab_panels ADD CONSTRAINT chk_lab_panel_removable_partial
  CHECK (is_allow_partial_billing = TRUE OR max_tests_removable = 0);

-- ── lab_panel_tests ─────────────────────────────────────────────────────────────
ALTER TABLE lab_panel_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panel_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_panel_tests_tenant_isolation ON lab_panel_tests;
CREATE POLICY lab_panel_tests_tenant_isolation ON lab_panel_tests
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- A lab test appears at most once per panel among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_test_unique
  ON lab_panel_tests (tenant_id, lab_panel_id, lab_test_id) WHERE deleted_at IS NULL;
-- Same rule for SITE_ADMIN template panels (NULL tenant_id).
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_test_siteadmin_unique
  ON lab_panel_tests (lab_panel_id, lab_test_id)
  WHERE deleted_at IS NULL AND tenant_id IS NULL;

-- ── test_groups (platform-level, NO RLS — like siteadmin_users) ─────────────────
-- SiteAdmin-only groupings of SITE_ADMIN lab-test templates; they sit above the
-- tenant boundary so they are deliberately NOT row-level-secured. Prisma can't
-- express partial unique indexes, so they live here:
-- group_name unique among ACTIVE rows (a name freed by soft-delete is reusable).
CREATE UNIQUE INDEX IF NOT EXISTS test_groups_name_active_unique
  ON test_groups (group_name) WHERE deleted_at IS NULL;

-- ── test_group_mappings (platform-level, NO RLS) ────────────────────────────────
-- a lab test appears at most once per group among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS test_group_mapping_active_unique
  ON test_group_mappings (test_group_id, lab_test_id) WHERE deleted_at IS NULL;

-- ── outsource_centers ─────────────────────────────────────────────────────────
ALTER TABLE outsource_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outsource_centers_tenant_isolation ON outsource_centers;
CREATE POLICY outsource_centers_tenant_isolation ON outsource_centers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant uniqueness for outsource-center name + code, among ACTIVE rows only
-- (partial index on deleted_at IS NULL), so a name/code freed by a soft-delete can
-- be reused. `code` is system-generated & immutable; `name` is user-set. Prisma
-- can't express partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS outsource_centers_tenant_code_active_unique
  ON outsource_centers (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS outsource_centers_tenant_name_active_unique
  ON outsource_centers (tenant_id, outsource_center_name) WHERE deleted_at IS NULL;

-- ── outsource_center_contacts ─────────────────────────────────────────────────
ALTER TABLE outsource_center_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_center_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occ_tenant_isolation ON outsource_center_contacts;
CREATE POLICY occ_tenant_isolation ON outsource_center_contacts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- At most one active contact per role per center.
CREATE UNIQUE INDEX IF NOT EXISTS occ_center_role_active_unique
  ON outsource_center_contacts (tenant_id, outsource_center_id, role)
  WHERE deleted_at IS NULL;

-- ── referral_panels ───────────────────────────────────────────────────────────
ALTER TABLE referral_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_panels_tenant_isolation ON referral_panels;
CREATE POLICY referral_panels_tenant_isolation ON referral_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant uniqueness for referral-panel name + code, among ACTIVE rows only.
-- `code` is system-generated & immutable; `name` is user-set. The user-supplied
-- `panel_code` is optional and unique per tenant only when present. Prisma can't
-- express partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS referral_panels_tenant_code_active_unique
  ON referral_panels (tenant_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS referral_panels_tenant_name_active_unique
  ON referral_panels (tenant_id, referral_panel_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS referral_panels_tenant_panel_code_active_unique
  ON referral_panels (tenant_id, panel_code)
  WHERE deleted_at IS NULL AND panel_code IS NOT NULL;

-- ── referral_panel_lab_tests ──────────────────────────────────────────────────
ALTER TABLE referral_panel_lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_panel_lab_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rplt_tenant_isolation ON referral_panel_lab_tests;
CREATE POLICY rplt_tenant_isolation ON referral_panel_lab_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab test appears at most once per referral panel among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS rplt_panel_test_active_unique
  ON referral_panel_lab_tests (tenant_id, referral_panel_id, lab_test_id)
  WHERE deleted_at IS NULL;

-- ── referral_panel_lab_panels ─────────────────────────────────────────────────
ALTER TABLE referral_panel_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_panel_lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rplp_tenant_isolation ON referral_panel_lab_panels;
CREATE POLICY rplp_tenant_isolation ON referral_panel_lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab panel appears at most once per referral panel among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS rplp_panel_labpanel_active_unique
  ON referral_panel_lab_panels (tenant_id, referral_panel_id, lab_panel_id)
  WHERE deleted_at IS NULL;

-- ── doctors ─────────────────────────────────────────────────────────────────────
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctors_tenant_isolation ON doctors;
CREATE POLICY doctors_tenant_isolation ON doctors
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `registration_no` is a per-tenant de-duplication key among ACTIVE rows only (a
-- value freed by a soft-delete can be reused). Prisma can't express partial
-- unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS doctors_tenant_registration_active_unique
  ON doctors (tenant_id, registration_no) WHERE deleted_at IS NULL;

-- ── doctor_qualifications ─────────────────────────────────────────────────────────
ALTER TABLE doctor_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_qualifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_qualifications_tenant_isolation ON doctor_qualifications;
CREATE POLICY doctor_qualifications_tenant_isolation ON doctor_qualifications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── doctor_experience ─────────────────────────────────────────────────────────────
ALTER TABLE doctor_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_experience FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_experience_tenant_isolation ON doctor_experience;
CREATE POLICY doctor_experience_tenant_isolation ON doctor_experience
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── doctor_branch_assignments ────────────────────────────────────────────────────
ALTER TABLE doctor_branch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_branch_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dba_tenant_isolation ON doctor_branch_assignments;
CREATE POLICY dba_tenant_isolation ON doctor_branch_assignments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One active assignment per (tenant, doctor, branch) among ACTIVE rows only (a
-- pairing freed by a soft-delete can be re-created). Prisma can't express partial
-- unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS dba_doctor_branch_active_unique
  ON doctor_branch_assignments (tenant_id, doctor_id, branch_id)
  WHERE deleted_at IS NULL;

-- ── referral_doctors ──────────────────────────────────────────────────────────
ALTER TABLE referral_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_doctors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_doctors_tenant_isolation ON referral_doctors;
CREATE POLICY referral_doctors_tenant_isolation ON referral_doctors
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── referral_doctor_qualifications ────────────────────────────────────────────
ALTER TABLE referral_doctor_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_doctor_qualifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_doctor_qualifications_tenant_isolation ON referral_doctor_qualifications;
CREATE POLICY referral_doctor_qualifications_tenant_isolation ON referral_doctor_qualifications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── referral_doctor_experience ────────────────────────────────────────────────
ALTER TABLE referral_doctor_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_doctor_experience FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_doctor_experience_tenant_isolation ON referral_doctor_experience;
CREATE POLICY referral_doctor_experience_tenant_isolation ON referral_doctor_experience
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── referral_doctor_lab_tests ─────────────────────────────────────────────────
ALTER TABLE referral_doctor_lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_doctor_lab_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rdlt_tenant_isolation ON referral_doctor_lab_tests;
CREATE POLICY rdlt_tenant_isolation ON referral_doctor_lab_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab test appears at most once per referral doctor among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS rdlt_doctor_test_active_unique
  ON referral_doctor_lab_tests (tenant_id, referral_doctor_id, lab_test_id)
  WHERE deleted_at IS NULL;

-- ── referral_doctor_lab_panels ────────────────────────────────────────────────
ALTER TABLE referral_doctor_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_doctor_lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rdlp_tenant_isolation ON referral_doctor_lab_panels;
CREATE POLICY rdlp_tenant_isolation ON referral_doctor_lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab panel appears at most once per referral doctor among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS rdlp_doctor_labpanel_active_unique
  ON referral_doctor_lab_panels (tenant_id, referral_doctor_id, lab_panel_id)
  WHERE deleted_at IS NULL;

-- ── external_referrals ────────────────────────────────────────────────────────
ALTER TABLE external_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_referrals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_referrals_tenant_isolation ON external_referrals;
CREATE POLICY external_referrals_tenant_isolation ON external_referrals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── external_referral_lab_tests ───────────────────────────────────────────────
ALTER TABLE external_referral_lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_referral_lab_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erlt_tenant_isolation ON external_referral_lab_tests;
CREATE POLICY erlt_tenant_isolation ON external_referral_lab_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab test appears at most once per external referral among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS erlt_referral_test_active_unique
  ON external_referral_lab_tests (tenant_id, external_referral_id, lab_test_id)
  WHERE deleted_at IS NULL;

-- ── external_referral_lab_panels ──────────────────────────────────────────────
ALTER TABLE external_referral_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_referral_lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erlp_tenant_isolation ON external_referral_lab_panels;
CREATE POLICY erlp_tenant_isolation ON external_referral_lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab panel appears at most once per external referral among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS erlp_referral_labpanel_active_unique
  ON external_referral_lab_panels (tenant_id, external_referral_id, lab_panel_id)
  WHERE deleted_at IS NULL;

-- ── internal_referrals ────────────────────────────────────────────────────────
ALTER TABLE internal_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_referrals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_referrals_tenant_isolation ON internal_referrals;
CREATE POLICY internal_referrals_tenant_isolation ON internal_referrals
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── internal_referral_lab_tests ───────────────────────────────────────────────
ALTER TABLE internal_referral_lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_referral_lab_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irlt_tenant_isolation ON internal_referral_lab_tests;
CREATE POLICY irlt_tenant_isolation ON internal_referral_lab_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab test appears at most once per internal referral among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS irlt_referral_test_active_unique
  ON internal_referral_lab_tests (tenant_id, internal_referral_id, lab_test_id)
  WHERE deleted_at IS NULL;

-- ── internal_referral_lab_panels ──────────────────────────────────────────────
ALTER TABLE internal_referral_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_referral_lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS irlp_tenant_isolation ON internal_referral_lab_panels;
CREATE POLICY irlp_tenant_isolation ON internal_referral_lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab panel appears at most once per internal referral among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS irlp_referral_labpanel_active_unique
  ON internal_referral_lab_panels (tenant_id, internal_referral_id, lab_panel_id)
  WHERE deleted_at IS NULL;

-- ── referral_panel_settings ───────────────────────────────────────────────────
ALTER TABLE referral_panel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_panel_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referral_panel_settings_tenant_isolation ON referral_panel_settings;
CREATE POLICY referral_panel_settings_tenant_isolation ON referral_panel_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- At most one default settings template per (tenant, client_type) among ACTIVE
-- (non-deleted) rows. The service also clears the prior default in a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS referral_panel_settings_default_active_unique
  ON referral_panel_settings (tenant_id, client_type)
  WHERE is_default = TRUE AND deleted_at IS NULL;

-- `setting_name` unique per tenant among ACTIVE rows (a value freed by a
-- soft-delete can be reused). Prisma can't express a partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS referral_panel_settings_name_active_unique
  ON referral_panel_settings (tenant_id, setting_name)
  WHERE deleted_at IS NULL;

-- ── tenant_staff_memberships ──────────────────────────────────────────────────
ALTER TABLE tenant_staff_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_staff_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tsm_tenant_isolation ON tenant_staff_memberships;
CREATE POLICY tsm_tenant_isolation ON tenant_staff_memberships
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant uniqueness for the staff user code among ACTIVE rows only. `user_code`
-- is system-generated & immutable. Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS tsm_tenant_user_code_active_unique
  ON tenant_staff_memberships (tenant_id, user_code) WHERE deleted_at IS NULL;

-- ── branch_modules ──────────────────────────────────────────────────────────────
ALTER TABLE branch_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_modules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_modules_tenant_isolation ON branch_modules;
CREATE POLICY branch_modules_tenant_isolation ON branch_modules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── user_branch_permissions ───────────────────────────────────────────────────
ALTER TABLE user_branch_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ubperm_tenant_isolation ON user_branch_permissions;
CREATE POLICY ubperm_tenant_isolation ON user_branch_permissions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── machines ────────────────────────────────────────────────────────────────────
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS machines_tenant_isolation ON machines;
CREATE POLICY machines_tenant_isolation ON machines
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── machine_reagent_kits ──────────────────────────────────────────────────────
ALTER TABLE machine_reagent_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_reagent_kits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS machine_reagent_kits_tenant_isolation ON machine_reagent_kits;
CREATE POLICY machine_reagent_kits_tenant_isolation ON machine_reagent_kits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── machine_test_mappings ─────────────────────────────────────────────────────
ALTER TABLE machine_test_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_test_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS machine_test_mappings_tenant_isolation ON machine_test_mappings;
CREATE POLICY machine_test_mappings_tenant_isolation ON machine_test_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── machine_adapter_logs ──────────────────────────────────────────────────────
ALTER TABLE machine_adapter_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_adapter_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS machine_adapter_logs_tenant_isolation ON machine_adapter_logs;
CREATE POLICY machine_adapter_logs_tenant_isolation ON machine_adapter_logs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── machine_branches ──────────────────────────────────────────────────────────
ALTER TABLE machine_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS machine_branches_tenant_isolation ON machine_branches;
CREATE POLICY machine_branches_tenant_isolation ON machine_branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One ACTIVE mapping per (tenant, machine, branch); a soft-deleted mapping can be
-- re-created. Prisma can't express partial unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS machine_branches_tenant_machine_branch_active_unique
  ON machine_branches (tenant_id, machine_id, branch_id) WHERE deleted_at IS NULL;

-- ── collection_center_mappings ───────────────────────────────────────────────
ALTER TABLE collection_center_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_center_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ccm_tenant_isolation ON collection_center_mappings;
CREATE POLICY ccm_tenant_isolation ON collection_center_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One ACTIVE mapping per (collection center, receiving branch); a soft-deleted
-- mapping can be re-created. Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS ccm_center_receiver_active_unique
  ON collection_center_mappings (collection_center_id, receiving_branch_id)
  WHERE deleted_at IS NULL;

-- ── documents ─────────────────────────────────────────────────────────────────
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_tenant_isolation ON documents;
CREATE POLICY documents_tenant_isolation ON documents
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `document_number` is unique per branch among ACTIVE rows only (a number freed
-- by a soft-delete can be reused). Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS documents_branch_number_active_unique
  ON documents (tenant_id, branch_id, document_number) WHERE deleted_at IS NULL;

-- ── document_versions ─────────────────────────────────────────────────────────
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_versions_tenant_isolation ON document_versions;
CREATE POLICY document_versions_tenant_isolation ON document_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── templates ─────────────────────────────────────────────────────────────────
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_tenant_isolation ON templates;
CREATE POLICY templates_tenant_isolation ON templates
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `code` is system-generated and unique per tenant among ACTIVE rows only (a
-- code freed by a soft-delete can be reused). Prisma can't express partial
-- unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS templates_tenant_code_active_unique
  ON templates (tenant_id, code) WHERE deleted_at IS NULL;

-- `name` is unique per (tenant, branch, type) among ACTIVE rows. Tenant-level
-- templates (business-admin, branch_id NULL) and branch-level templates
-- (branch-admin) live in the same table; Postgres treats NULLs as distinct in a
-- unique index, so a single index over the nullable branch_id would NOT enforce
-- uniqueness among tenant-level rows. Split into two partial indexes (mirroring
-- the categories dept-vs-independent pattern).
CREATE UNIQUE INDEX IF NOT EXISTS templates_branch_type_name_active_unique
  ON templates (tenant_id, branch_id, type, name)
  WHERE deleted_at IS NULL AND branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS templates_tenant_type_name_active_unique
  ON templates (tenant_id, type, name)
  WHERE deleted_at IS NULL AND branch_id IS NULL;

-- ── lab_image_settings ────────────────────────────────────────────────────────
ALTER TABLE lab_image_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_image_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_image_settings_tenant_isolation ON lab_image_settings;
CREATE POLICY lab_image_settings_tenant_isolation ON lab_image_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_pdf_settings ──────────────────────────────────────────────────────────
ALTER TABLE lab_pdf_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_pdf_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_pdf_settings_tenant_isolation ON lab_pdf_settings;
CREATE POLICY lab_pdf_settings_tenant_isolation ON lab_pdf_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_group_layout_settings ─────────────────────────────────────────────────
ALTER TABLE lab_group_layout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_group_layout_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_group_layout_settings_tenant_isolation ON lab_group_layout_settings;
CREATE POLICY lab_group_layout_settings_tenant_isolation ON lab_group_layout_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_icon_settings ─────────────────────────────────────────────────────────
ALTER TABLE lab_icon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_icon_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_icon_settings_tenant_isolation ON lab_icon_settings;
CREATE POLICY lab_icon_settings_tenant_isolation ON lab_icon_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Platform-level tables (tenants, persons, person_credentials, siteadmin_users,
-- refresh_tokens, person_tenant_enrollments, test_groups, test_group_mappings)
-- are intentionally NOT covered — they sit above the tenant boundary. (The
-- test_groups partial unique indexes above are added for correctness, not RLS.)
--
-- NOTE on Person.aadhaar_number / pan_number: no unique index. Aadhaar is stored
-- encrypted (AES-256-GCM with a random IV → identical inputs yield different
-- ciphertext), so a uniqueness index would be meaningless; the v2.0 spec requires
-- format validation, not de-duplication, for these fields.
