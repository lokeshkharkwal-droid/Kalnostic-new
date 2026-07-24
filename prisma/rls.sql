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

-- ── auth_roles ──────────────────────────────────────────────────────────────────
-- Tenant rows are custom roles isolated by tenant_id; system roles (tenant_id
-- NULL) are seeded, shared, and readable by every tenant (writable only by a
-- GUC-less connection, e.g. the seed), mirroring the departments/lab_test
-- template pattern. This policy is strictly more permissive than
-- user_branch_profiles below (it also allows NULL-tenant reads), so a profile's
-- role relation always resolves wherever the profile itself is visible.
ALTER TABLE auth_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_roles_tenant_isolation ON auth_roles;
CREATE POLICY auth_roles_tenant_isolation ON auth_roles
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Custom roles: key/name unique per tenant among ACTIVE rows (a key/name freed
-- by a soft-delete can be reused). Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_tenant_key_active_unique
  ON auth_roles (tenant_id, key)
  WHERE deleted_at IS NULL AND tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_tenant_name_active_unique
  ON auth_roles (tenant_id, name)
  WHERE deleted_at IS NULL AND tenant_id IS NOT NULL;

-- System roles have tenant_id NULL; Postgres treats NULLs as distinct, so the
-- per-tenant indexes above don't constrain them. These enforce global
-- uniqueness of key / name across ACTIVE system rows.
CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_system_key_active_unique
  ON auth_roles (key) WHERE deleted_at IS NULL AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS auth_roles_system_name_active_unique
  ON auth_roles (name) WHERE deleted_at IS NULL AND tenant_id IS NULL;

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

-- ── equipment (platform-level, NO RLS — like test_groups) ───────────────────────
-- SiteAdmin-only global lab-equipment catalogue; it sits above the tenant
-- boundary so it is deliberately NOT row-level-secured. Prisma can't express
-- partial unique indexes, so they live here:
-- name unique among ACTIVE rows (a name freed by soft-delete is reusable).
CREATE UNIQUE INDEX IF NOT EXISTS equipment_name_active_unique
  ON equipment (name) WHERE deleted_at IS NULL;

-- ── equipment_lab_tests (platform-level, NO RLS) ────────────────────────────────
-- a lab test appears at most once per equipment among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS equipment_lab_test_active_unique
  ON equipment_lab_tests (equipment_id, lab_test_id) WHERE deleted_at IS NULL;

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
-- This index covers branch-level rows; Postgres treats NULL branch_id as
-- distinct, so tenant-level docs are handled by the companion index below.
CREATE UNIQUE INDEX IF NOT EXISTS documents_branch_number_active_unique
  ON documents (tenant_id, branch_id, document_number) WHERE deleted_at IS NULL;

-- Tenant-level documents (branch_id IS NULL, managed by a Business Admin) are
-- unique per (tenant, number) among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_number_active_unique
  ON documents (tenant_id, document_number)
  WHERE deleted_at IS NULL AND branch_id IS NULL;

-- ── document_versions ─────────────────────────────────────────────────────────
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_versions_tenant_isolation ON document_versions;
CREATE POLICY document_versions_tenant_isolation ON document_versions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── templates ─────────────────────────────────────────────────────────────────
-- Tenant rows isolate by tenant_id; SITE_ADMIN global templates (tenant_id NULL)
-- are readable by everyone and writable only by a GUC-less SiteAdmin connection
-- (mirrors the pdf_report_templates pattern below).
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS templates_tenant_isolation ON templates;
CREATE POLICY templates_tenant_isolation ON templates
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Messaging templates carry no name/code uniqueness: multiple templates may
-- exist per (feature, preference, level) and `is_default` marks the fallback.

-- ── pdf_report_templates ──────────────────────────────────────────────────────
-- Tenant rows isolate by tenant_id; SITE_ADMIN global templates (tenant_id NULL)
-- are readable by everyone and writable only by a GUC-less SiteAdmin connection.
ALTER TABLE pdf_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_report_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prt_tenant_isolation ON pdf_report_templates;
CREATE POLICY prt_tenant_isolation ON pdf_report_templates
  USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (
    tenant_id = current_tenant_id()
    OR (tenant_id IS NULL AND current_tenant_id() IS NULL)
  );

-- Template name is unique per tenant among ACTIVE rows only (a name freed by a
-- soft-delete can be reused). Independent of branch_id — a tenant cannot hold
-- two active templates with the same name whether tenant-wide or branch-scoped.
-- Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS prt_tenant_name_active_unique
  ON pdf_report_templates (tenant_id, name) WHERE deleted_at IS NULL;

-- ── pdf_template_configs ──────────────────────────────────────────────────────
-- Per-tenant (optionally per-branch) default-template-per-slot map. Never global,
-- so the policy is a plain tenant isolation (no NULL-tenant clause).
ALTER TABLE pdf_template_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_template_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptc_tenant_isolation ON pdf_template_configs;
CREATE POLICY ptc_tenant_isolation ON pdf_template_configs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One active assignment per (tenant, branch, slot). Postgres treats NULLs as
-- distinct, so branch-level and tenant-level (NULL branch) rows need separate
-- partial unique indexes (mirrors the auth_roles pattern). Prisma can't express
-- partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS ptc_tenant_branch_slot_active_unique
  ON pdf_template_configs (tenant_id, branch_id, slot_key)
  WHERE deleted_at IS NULL AND branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ptc_tenant_slot_active_unique
  ON pdf_template_configs (tenant_id, slot_key)
  WHERE deleted_at IS NULL AND branch_id IS NULL;

-- ── branch_lab_tests ──────────────────────────────────────────────────────────
ALTER TABLE branch_lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_lab_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_lab_tests_tenant_isolation ON branch_lab_tests;
CREATE POLICY branch_lab_tests_tenant_isolation ON branch_lab_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- NOTE: `test_name`/`test_code` are intentionally NOT unique per branch — a user
-- may create independent DUPLICATES of an imported test (same code, different
-- pricing), so the earlier unique indexes are dropped if present.
DROP INDEX IF EXISTS branch_lab_test_name_active_unique;
DROP INDEX IF EXISTS branch_lab_test_code_active_unique;

-- Variant model: rows sharing a `source_lab_test_id` form a group (one imported
-- original + its duplicates). Exactly ONE active row per group may be the default
-- (used for order creation). Prisma can't express partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS branch_lab_test_default_per_source_unique
  ON branch_lab_tests (tenant_id, branch_id, source_lab_test_id)
  WHERE is_default AND deleted_at IS NULL;

-- Price-ordering CHECK constraints, mirroring lab_test (defence in depth).
ALTER TABLE branch_lab_tests DROP CONSTRAINT IF EXISTS chk_branch_lab_test_price_max_lte_msrp;
ALTER TABLE branch_lab_tests ADD CONSTRAINT chk_branch_lab_test_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE branch_lab_tests DROP CONSTRAINT IF EXISTS chk_branch_lab_test_price_min_lte_max;
ALTER TABLE branch_lab_tests ADD CONSTRAINT chk_branch_lab_test_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE branch_lab_tests DROP CONSTRAINT IF EXISTS chk_branch_lab_test_discount_cap_range;
ALTER TABLE branch_lab_tests ADD CONSTRAINT chk_branch_lab_test_discount_cap_range
  CHECK (discount_cap_pct BETWEEN 0 AND 100);

-- ── branch_lab_panels ─────────────────────────────────────────────────────────
ALTER TABLE branch_lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_lab_panels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_lab_panels_tenant_isolation ON branch_lab_panels;
CREATE POLICY branch_lab_panels_tenant_isolation ON branch_lab_panels
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Duplicates are allowed (mirrors branch_lab_tests) — drop the old name/code
-- unique indexes if present; enforce ONE default per source group instead.
DROP INDEX IF EXISTS branch_lab_panel_name_active_unique;
DROP INDEX IF EXISTS branch_lab_panel_code_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS branch_lab_panel_default_per_source_unique
  ON branch_lab_panels (tenant_id, branch_id, source_lab_panel_id)
  WHERE is_default AND deleted_at IS NULL;

-- Price-ordering CHECK constraints, mirroring lab_panels (defence in depth).
ALTER TABLE branch_lab_panels DROP CONSTRAINT IF EXISTS chk_branch_lab_panel_price_max_lte_msrp;
ALTER TABLE branch_lab_panels ADD CONSTRAINT chk_branch_lab_panel_price_max_lte_msrp
  CHECK (price_maximum <= price_msrp);
ALTER TABLE branch_lab_panels DROP CONSTRAINT IF EXISTS chk_branch_lab_panel_price_min_lte_max;
ALTER TABLE branch_lab_panels ADD CONSTRAINT chk_branch_lab_panel_price_min_lte_max
  CHECK (price_minimum <= price_maximum);
ALTER TABLE branch_lab_panels DROP CONSTRAINT IF EXISTS chk_branch_lab_panel_max_removable_nonneg;
ALTER TABLE branch_lab_panels ADD CONSTRAINT chk_branch_lab_panel_max_removable_nonneg
  CHECK (max_tests_removable >= 0);

-- ── branch_lab_panel_tests ────────────────────────────────────────────────────
ALTER TABLE branch_lab_panel_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_lab_panel_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_lab_panel_tests_tenant_isolation ON branch_lab_panel_tests;
CREATE POLICY branch_lab_panel_tests_tenant_isolation ON branch_lab_panel_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A branch test appears at most once per branch panel among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS branch_lab_panel_test_active_unique
  ON branch_lab_panel_tests (tenant_id, branch_lab_panel_id, branch_lab_test_id)
  WHERE deleted_at IS NULL;

-- ── support_infos (platform-level, NO RLS — like siteadmin_users) ───────────────
-- SiteAdmin-authored help/support content shared across all tenants; it sits
-- above the tenant boundary so it is deliberately NOT row-level-secured. Prisma
-- can't express partial unique indexes, so it lives here: title unique among
-- ACTIVE rows (a title freed by soft-delete is reusable). `code` is user-supplied
-- and intentionally NOT unique.
CREATE UNIQUE INDEX IF NOT EXISTS support_infos_title_active_unique
  ON support_infos (title) WHERE deleted_at IS NULL;

-- ── patients ─────────────────────────────────────────────────────────────────
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patients_tenant_isolation ON patients;
CREATE POLICY patients_tenant_isolation ON patients
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique mobile among ACTIVE rows (a number freed by a soft-delete is
-- reusable). Prevents duplicate active patients on the same mobile. Prisma can't
-- express partial unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_mobile_active_unique
  ON patients (tenant_id, mobile) WHERE deleted_at IS NULL;

-- ── medical_histories ───────────────────────────────────────────────────────────
ALTER TABLE medical_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_histories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS medical_histories_tenant_isolation ON medical_histories;
CREATE POLICY medical_histories_tenant_isolation ON medical_histories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── patient_family_links ──────────────────────────────────────────────────────
ALTER TABLE patient_family_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_family_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patient_family_links_tenant_isolation ON patient_family_links;
CREATE POLICY patient_family_links_tenant_isolation ON patient_family_links
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── Order Management ────────────────────────────────────────────────────────────

-- ── orders ──────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique order code among ACTIVE rows (a code freed by a soft-delete
-- is reusable). `order_code` is system-generated (ORD-00001…) & immutable.
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_code_active_unique
  ON orders (tenant_id, order_code) WHERE deleted_at IS NULL;

-- ── order_items ───────────────────────────────────────────────────────────────
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_tenant_isolation ON order_items;
CREATE POLICY order_items_tenant_isolation ON order_items
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Exactly one of branch_lab_test_id / branch_lab_panel_id / direct must be set
-- per row (an order item is a catalogue test, a catalogue panel, or a free-text
-- direct entry). Prisma can't express this, so it lives here. Defence in front
-- of the same check in OrderService.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_test_xor_panel;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_source_exactly_one;
ALTER TABLE order_items ADD CONSTRAINT order_items_source_exactly_one
  CHECK (
      (CASE WHEN branch_lab_test_id  IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN branch_lab_panel_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN direct              IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- ── order_diagnostics ───────────────────────────────────────────────────────────
ALTER TABLE order_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_diagnostics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_diagnostics_tenant_isolation ON order_diagnostics;
CREATE POLICY order_diagnostics_tenant_isolation ON order_diagnostics
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── order_opd ─────────────────────────────────────────────────────────────────
ALTER TABLE order_opd ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_opd FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_opd_tenant_isolation ON order_opd;
CREATE POLICY order_opd_tenant_isolation ON order_opd
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── order_radiology ─────────────────────────────────────────────────────────────
ALTER TABLE order_radiology ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_radiology FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_radiology_tenant_isolation ON order_radiology;
CREATE POLICY order_radiology_tenant_isolation ON order_radiology
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── order_field_configs ─────────────────────────────────────────────────────────
ALTER TABLE order_field_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_field_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_field_configs_tenant_isolation ON order_field_configs;
CREATE POLICY order_field_configs_tenant_isolation ON order_field_configs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── radiologists ────────────────────────────────────────────────────────────────
ALTER TABLE radiologists ENABLE ROW LEVEL SECURITY;
ALTER TABLE radiologists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS radiologists_tenant_isolation ON radiologists;
CREATE POLICY radiologists_tenant_isolation ON radiologists
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── phlebotomists ─────────────────────────────────────────────────────────────
ALTER TABLE phlebotomists ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomists_tenant_isolation ON phlebotomists;
CREATE POLICY phlebotomists_tenant_isolation ON phlebotomists
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── payment_details ─────────────────────────────────────────────────────────────
ALTER TABLE payment_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_details FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_details_tenant_isolation ON payment_details;
CREATE POLICY payment_details_tenant_isolation ON payment_details
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

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

-- ── Appointment Status Tracking ─────────────────────────────────────────────────

-- ── appointments ──────────────────────────────────────────────────────────────
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointments_tenant_isolation ON appointments;
CREATE POLICY appointments_tenant_isolation ON appointments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique appointment code among ACTIVE rows (a code freed by a
-- soft-delete is reusable). `code` is system-generated (APT-00001…) & immutable.
-- Prisma can't express partial unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_tenant_code_active_unique
  ON appointments (tenant_id, code) WHERE deleted_at IS NULL;

-- ── appointment_status_history ────────────────────────────────────────────────
ALTER TABLE appointment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointment_status_history_tenant_isolation ON appointment_status_history;
CREATE POLICY appointment_status_history_tenant_isolation ON appointment_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── Phlebotomist / Home Sample Collection ──────────────────────────────────────

-- ── home_visit_collections ────────────────────────────────────────────────────
ALTER TABLE home_visit_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_visit_collections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS home_visit_collections_tenant_isolation ON home_visit_collections;
CREATE POLICY home_visit_collections_tenant_isolation ON home_visit_collections
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── home_visit_status_history ─────────────────────────────────────────────────
ALTER TABLE home_visit_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_visit_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS home_visit_status_history_tenant_isolation ON home_visit_status_history;
CREATE POLICY home_visit_status_history_tenant_isolation ON home_visit_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── Doctor Schedule ─────────────────────────────────────────────────────────────

-- ── doctor_schedules ──────────────────────────────────────────────────────────
ALTER TABLE doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_schedules_tenant_isolation ON doctor_schedules;
CREATE POLICY doctor_schedules_tenant_isolation ON doctor_schedules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- At most one ACTIVE schedule per (tenant, doctor, branch) among active rows.
-- Prisma can't express partial unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_schedules_active_doctor_branch_unique
  ON doctor_schedules (tenant_id, doctor_id, branch_id)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

-- ── doctor_schedule_days ──────────────────────────────────────────────────────
ALTER TABLE doctor_schedule_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_schedule_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_schedule_days_tenant_isolation ON doctor_schedule_days;
CREATE POLICY doctor_schedule_days_tenant_isolation ON doctor_schedule_days
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── doctor_schedule_holidays ──────────────────────────────────────────────────
ALTER TABLE doctor_schedule_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_schedule_holidays FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_schedule_holidays_tenant_isolation ON doctor_schedule_holidays;
CREATE POLICY doctor_schedule_holidays_tenant_isolation ON doctor_schedule_holidays
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── doctor_schedule_overrides ─────────────────────────────────────────────────
ALTER TABLE doctor_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_schedule_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_schedule_overrides_tenant_isolation ON doctor_schedule_overrides;
CREATE POLICY doctor_schedule_overrides_tenant_isolation ON doctor_schedule_overrides
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── doctor_slots ──────────────────────────────────────────────────────────────
ALTER TABLE doctor_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_slots_tenant_isolation ON doctor_slots;
CREATE POLICY doctor_slots_tenant_isolation ON doctor_slots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One slot per (schedule, date, start time) among active rows, so slot
-- regeneration upserts rather than duplicating. Prisma can't express partial
-- unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_slots_schedule_date_start_active_unique
  ON doctor_slots (schedule_id, slot_date, start_time) WHERE deleted_at IS NULL;

-- ── Phlebotomist Schedule ───────────────────────────────────────────────────────

-- ── service_zones ─────────────────────────────────────────────────────────────
ALTER TABLE service_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_zones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_zones_tenant_isolation ON service_zones;
CREATE POLICY service_zones_tenant_isolation ON service_zones
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-branch uniqueness for zone name (and code when present) among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS service_zones_tenant_branch_name_active_unique
  ON service_zones (tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_zones_tenant_branch_code_active_unique
  ON service_zones (tenant_id, branch_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;

-- ── phlebotomist_schedules ────────────────────────────────────────────────────
ALTER TABLE phlebotomist_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_schedules_tenant_isolation ON phlebotomist_schedules;
CREATE POLICY phlebotomist_schedules_tenant_isolation ON phlebotomist_schedules
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- At most one ACTIVE schedule per (tenant, phlebotomist, branch) among active rows.
-- Prisma can't express partial unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS phlebotomist_schedules_active_phleb_branch_unique
  ON phlebotomist_schedules (tenant_id, phlebotomist_id, branch_id)
  WHERE deleted_at IS NULL AND status = 'ACTIVE';

-- ── phlebotomist_schedule_days ────────────────────────────────────────────────
ALTER TABLE phlebotomist_schedule_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_schedule_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_schedule_days_tenant_isolation ON phlebotomist_schedule_days;
CREATE POLICY phlebotomist_schedule_days_tenant_isolation ON phlebotomist_schedule_days
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── phlebotomist_schedule_zones ───────────────────────────────────────────────
ALTER TABLE phlebotomist_schedule_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_schedule_zones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_schedule_zones_tenant_isolation ON phlebotomist_schedule_zones;
CREATE POLICY phlebotomist_schedule_zones_tenant_isolation ON phlebotomist_schedule_zones
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── phlebotomist_schedule_holidays ────────────────────────────────────────────
ALTER TABLE phlebotomist_schedule_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_schedule_holidays FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_schedule_holidays_tenant_isolation ON phlebotomist_schedule_holidays;
CREATE POLICY phlebotomist_schedule_holidays_tenant_isolation ON phlebotomist_schedule_holidays
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── phlebotomist_schedule_overrides ───────────────────────────────────────────
ALTER TABLE phlebotomist_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_schedule_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_schedule_overrides_tenant_isolation ON phlebotomist_schedule_overrides;
CREATE POLICY phlebotomist_schedule_overrides_tenant_isolation ON phlebotomist_schedule_overrides
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── phlebotomist_slots ────────────────────────────────────────────────────────
ALTER TABLE phlebotomist_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_slots_tenant_isolation ON phlebotomist_slots;
CREATE POLICY phlebotomist_slots_tenant_isolation ON phlebotomist_slots
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- One slot per (schedule, date, start time) among active rows, so slot
-- regeneration upserts rather than duplicating. Prisma can't express partial
-- unique indexes, so it lives here.
CREATE UNIQUE INDEX IF NOT EXISTS phlebotomist_slots_schedule_date_start_active_unique
  ON phlebotomist_slots (schedule_id, slot_date, start_time) WHERE deleted_at IS NULL;

-- ── phlebotomist_day_loads ────────────────────────────────────────────────────
ALTER TABLE phlebotomist_day_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE phlebotomist_day_loads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phlebotomist_day_loads_tenant_isolation ON phlebotomist_day_loads;
CREATE POLICY phlebotomist_day_loads_tenant_isolation ON phlebotomist_day_loads
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── accession_samples ─────────────────────────────────────────────────────────
ALTER TABLE accession_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_samples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_samples_tenant_isolation ON accession_samples;
CREATE POLICY accession_samples_tenant_isolation ON accession_samples
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique accession number + barcode among ACTIVE rows (a value freed
-- by a soft-delete is reusable). Both are system-generated (ACC-00001…/BAR-…).
-- Prisma can't express partial unique indexes, so they live here.
CREATE UNIQUE INDEX IF NOT EXISTS accession_samples_tenant_accession_no_active_unique
  ON accession_samples (tenant_id, accession_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accession_samples_tenant_barcode_active_unique
  ON accession_samples (tenant_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

-- ── accession_sample_tests ────────────────────────────────────────────────────
ALTER TABLE accession_sample_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_sample_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_sample_tests_tenant_isolation ON accession_sample_tests;
CREATE POLICY accession_sample_tests_tenant_isolation ON accession_sample_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── accession_status_history ──────────────────────────────────────────────────
ALTER TABLE accession_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_status_history_tenant_isolation ON accession_status_history;
CREATE POLICY accession_status_history_tenant_isolation ON accession_status_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── sample_transfers ──────────────────────────────────────────────────────────
ALTER TABLE sample_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sample_transfers_tenant_isolation ON sample_transfers;
CREATE POLICY sample_transfers_tenant_isolation ON sample_transfers
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── accession_settings ────────────────────────────────────────────────────────
ALTER TABLE accession_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accession_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accession_settings_tenant_isolation ON accession_settings;
CREATE POLICY accession_settings_tenant_isolation ON accession_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_adapters ──────────────────────────────────────────────────────────────
-- A tenant's instrument-integration bridge; references a global SITE_ADMIN
-- equipment, assigned to N branches, maps branch lab tests.
ALTER TABLE lab_adapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_adapters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_adapters_tenant_isolation ON lab_adapters;
CREATE POLICY lab_adapters_tenant_isolation ON lab_adapters
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- An adapter name is unique per tenant among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_adapter_name_active_unique
  ON lab_adapters (tenant_id, name) WHERE deleted_at IS NULL;

-- ── lab_adapter_branches ──────────────────────────────────────────────────────
ALTER TABLE lab_adapter_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_adapter_branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_adapter_branches_tenant_isolation ON lab_adapter_branches;
CREATE POLICY lab_adapter_branches_tenant_isolation ON lab_adapter_branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A branch is assigned to an adapter at most once among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_adapter_branch_active_unique
  ON lab_adapter_branches (tenant_id, lab_adapter_id, branch_id)
  WHERE deleted_at IS NULL;

-- ── lab_adapter_tests ─────────────────────────────────────────────────────────
ALTER TABLE lab_adapter_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_adapter_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_adapter_tests_tenant_isolation ON lab_adapter_tests;
CREATE POLICY lab_adapter_tests_tenant_isolation ON lab_adapter_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- A branch lab test is mapped to an adapter at most once among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_adapter_test_active_unique
  ON lab_adapter_tests (tenant_id, lab_adapter_id, branch_lab_test_id)
  WHERE deleted_at IS NULL;

-- Platform-level tables (tenants, persons, person_credentials, siteadmin_users,
-- refresh_tokens, person_tenant_enrollments, test_groups, test_group_mappings,
-- equipment, equipment_lab_tests, support_infos) are intentionally NOT covered —
-- they sit above the tenant boundary. (The test_groups / equipment /
-- support_infos partial unique indexes above are added for correctness, not RLS.)
--
-- NOTE on Person.aadhaar_number / pan_number: no unique index. Aadhaar is stored
-- encrypted (AES-256-GCM with a random IV → identical inputs yield different
-- ciphertext), so a uniqueness index would be meaningless; the v2.0 spec requires
-- format validation, not de-duplication, for these fields.

-- ══════════════════════════════════════════════════════════════════════════════
-- Sales & B2B module (tenant-scoped tables)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── sales_territories ─────────────────────────────────────────────────────────
ALTER TABLE sales_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_territories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_territories_tenant_isolation ON sales_territories;
CREATE POLICY sales_territories_tenant_isolation ON sales_territories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── leads ─────────────────────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_tenant_isolation ON leads;
CREATE POLICY leads_tenant_isolation ON leads
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique lead code among ACTIVE rows (system-generated LD-YYYY-#####).
CREATE UNIQUE INDEX IF NOT EXISTS leads_tenant_lead_code_active_unique
  ON leads (tenant_id, lead_code) WHERE deleted_at IS NULL;

-- ── lead_status_histories (immutable; no soft-delete) ─────────────────────────
ALTER TABLE lead_status_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_status_histories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_status_histories_tenant_isolation ON lead_status_histories;
CREATE POLICY lead_status_histories_tenant_isolation ON lead_status_histories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lead_meetings ─────────────────────────────────────────────────────────────
ALTER TABLE lead_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_meetings_tenant_isolation ON lead_meetings;
CREATE POLICY lead_meetings_tenant_isolation ON lead_meetings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── follow_ups ────────────────────────────────────────────────────────────────
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_ups_tenant_isolation ON follow_ups;
CREATE POLICY follow_ups_tenant_isolation ON follow_ups
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique follow-up code among ACTIVE rows (system-generated FU-#####).
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_tenant_follow_up_code_active_unique
  ON follow_ups (tenant_id, follow_up_code) WHERE deleted_at IS NULL;

-- ── follow_up_status_histories (immutable; no soft-delete) ────────────────────
ALTER TABLE follow_up_status_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_status_histories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS follow_up_status_histories_tenant_isolation ON follow_up_status_histories;
CREATE POLICY follow_up_status_histories_tenant_isolation ON follow_up_status_histories
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── trips ─────────────────────────────────────────────────────────────────────
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trips_tenant_isolation ON trips;
CREATE POLICY trips_tenant_isolation ON trips
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Per-tenant unique trip code among ACTIVE rows (system-generated TRP-#####).
CREATE UNIQUE INDEX IF NOT EXISTS trips_tenant_trip_code_active_unique
  ON trips (tenant_id, trip_code) WHERE deleted_at IS NULL;

-- ── trip_visits ───────────────────────────────────────────────────────────────
ALTER TABLE trip_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_visits_tenant_isolation ON trip_visits;
CREATE POLICY trip_visits_tenant_isolation ON trip_visits
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── sales_settings ────────────────────────────────────────────────────────────
ALTER TABLE sales_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_settings_tenant_isolation ON sales_settings;
CREATE POLICY sales_settings_tenant_isolation ON sales_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
