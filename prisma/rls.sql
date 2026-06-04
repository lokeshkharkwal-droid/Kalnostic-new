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
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ── branches ──────────────────────────────────────────────────────────────────
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branches_tenant_isolation ON branches;
CREATE POLICY branches_tenant_isolation ON branches
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

-- Platform-level tables (tenants, persons, person_credentials, siteadmin_users,
-- refresh_tokens, person_tenant_enrollments) are intentionally NOT covered —
-- they sit above the tenant boundary.
