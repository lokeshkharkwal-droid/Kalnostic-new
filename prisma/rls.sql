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

-- Platform-level tables (tenants, persons, person_credentials, siteadmin_users,
-- refresh_tokens, person_tenant_enrollments) are intentionally NOT covered —
-- they sit above the tenant boundary.
