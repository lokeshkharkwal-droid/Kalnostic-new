-- Row-Level Security + partial unique index for the permission-management
-- additions — mirrors the blocks added to prisma/rls.sql. Tenant-isolation
-- policy keyed on tenant_id (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS /
-- FORCE / IF NOT EXISTS), and runs after 1_row_level_security so
-- current_tenant_id() already exists.

-- ── branch_role_permissions ──
ALTER TABLE branch_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brp_tenant_isolation ON branch_role_permissions;
CREATE POLICY brp_tenant_isolation ON branch_role_permissions
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── registration_settings — tenant-level (business) row uniqueness ──
-- branch_id is now nullable; @@unique([tenantId, branchId]) can't guard the
-- tenant-level row (Postgres treats NULLs as distinct), so enforce one-per-tenant.
CREATE UNIQUE INDEX IF NOT EXISTS registration_settings_tenant_level_unique
  ON registration_settings (tenant_id) WHERE branch_id IS NULL AND deleted_at IS NULL;
