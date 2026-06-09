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

-- ── department_person_mappings ────────────────────────────────────────────────────
ALTER TABLE department_person_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_person_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dpm_tenant_isolation ON department_person_mappings;
CREATE POLICY dpm_tenant_isolation ON department_person_mappings
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
