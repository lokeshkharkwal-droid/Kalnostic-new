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
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
CREATE POLICY departments_tenant_isolation ON departments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

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

-- ── department_person_mappings ────────────────────────────────────────────────────
ALTER TABLE department_person_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_person_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dpm_tenant_isolation ON department_person_mappings;
CREATE POLICY dpm_tenant_isolation ON department_person_mappings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── categories ──────────────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_tenant_isolation ON categories;
CREATE POLICY categories_tenant_isolation ON categories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

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
ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_categories_tenant_isolation ON sub_categories;
CREATE POLICY sub_categories_tenant_isolation ON sub_categories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

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

-- ── lab_test ────────────────────────────────────────────────────────────────────
ALTER TABLE lab_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_tenant_isolation ON lab_test;
CREATE POLICY lab_test_tenant_isolation ON lab_test
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `test_name` / `test_code` unique per master data among ACTIVE rows only (a value
-- freed by a soft-delete can be reused). Per master data (not tenant) so cloning a
-- test into another branch's master data is allowed. Prisma can't express these.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_md_name_active_unique
  ON lab_test (tenant_id, master_data_id, test_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_md_code_active_unique
  ON lab_test (tenant_id, master_data_id, test_code) WHERE deleted_at IS NULL;

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
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- At most one default sample per test among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_sample_default_active_unique
  ON lab_test_samples (tenant_id, lab_test_id)
  WHERE is_default = TRUE AND deleted_at IS NULL;

ALTER TABLE lab_test_samples DROP CONSTRAINT IF EXISTS chk_lab_test_sample_number;
ALTER TABLE lab_test_samples ADD CONSTRAINT chk_lab_test_sample_number
  CHECK (number_of_samples >= 1);

-- ── lab_test_result_params ──────────────────────────────────────────────────────
ALTER TABLE lab_test_result_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_result_params FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_result_params_tenant_isolation ON lab_test_result_params;
CREATE POLICY lab_test_result_params_tenant_isolation ON lab_test_result_params
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `parameter_code` unique per test among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_test_param_code_active_unique
  ON lab_test_result_params (tenant_id, lab_test_id, parameter_code) WHERE deleted_at IS NULL;

ALTER TABLE lab_test_result_params DROP CONSTRAINT IF EXISTS chk_lab_test_param_calc_formula;
ALTER TABLE lab_test_result_params ADD CONSTRAINT chk_lab_test_param_calc_formula
  CHECK (parameter_type != 'CALCULATED' OR calculation_formula IS NOT NULL);
ALTER TABLE lab_test_result_params DROP CONSTRAINT IF EXISTS chk_lab_test_param_decimals;
ALTER TABLE lab_test_result_params ADD CONSTRAINT chk_lab_test_param_decimals
  CHECK (decimal_places BETWEEN 0 AND 6);

-- ── lab_test_reference_ranges ─────────────────────────────────────────────────────
ALTER TABLE lab_test_reference_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_test_reference_ranges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_test_reference_ranges_tenant_isolation ON lab_test_reference_ranges;
CREATE POLICY lab_test_reference_ranges_tenant_isolation ON lab_test_reference_ranges
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

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
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE lab_test_reference_values DROP CONSTRAINT IF EXISTS chk_ref_value_age;
ALTER TABLE lab_test_reference_values ADD CONSTRAINT chk_ref_value_age
  CHECK (age_from <= age_to);

-- ── lab_panels ──────────────────────────────────────────────────────────────────
ALTER TABLE lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_panels_tenant_isolation ON lab_panels;
CREATE POLICY lab_panels_tenant_isolation ON lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- `panel_name` / `panel_code` unique per master data among ACTIVE rows only (a
-- value freed by a soft-delete can be reused). Per master data (not tenant), like
-- lab_test. Prisma can't express these.
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_md_name_active_unique
  ON lab_panels (tenant_id, master_data_id, panel_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_md_code_active_unique
  ON lab_panels (tenant_id, master_data_id, panel_code) WHERE deleted_at IS NULL;

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
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A lab test appears at most once per panel among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_panel_test_unique
  ON lab_panel_tests (tenant_id, lab_panel_id, lab_test_id) WHERE deleted_at IS NULL;

-- Platform-level tables (tenants, persons, person_credentials, siteadmin_users,
-- refresh_tokens, person_tenant_enrollments) are intentionally NOT covered —
-- they sit above the tenant boundary.
