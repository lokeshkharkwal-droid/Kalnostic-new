-- Row-Level Security + uniqueness for the notification-enablement tables — mirrors
-- the blocks added to prisma/rls.sql. Tenant-isolation policies keyed on tenant_id
-- (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS / IF NOT EXISTS), and runs after
-- 1_row_level_security so current_tenant_id() already exists.

-- ── business_channel_settings ──
ALTER TABLE business_channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_channel_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_channel_settings_tenant_isolation ON business_channel_settings;
CREATE POLICY business_channel_settings_tenant_isolation ON business_channel_settings
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- branch_id nullable: one tenant-level default row vs one per branch. Partial
-- indexes because Postgres treats NULL branch_id as distinct under @@unique.
CREATE UNIQUE INDEX IF NOT EXISTS business_channel_settings_tenant_level_unique
  ON business_channel_settings (tenant_id) WHERE branch_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_channel_settings_branch_level_unique
  ON business_channel_settings (tenant_id, branch_id) WHERE branch_id IS NOT NULL AND deleted_at IS NULL;

-- ── business_channel_overrides ──
ALTER TABLE business_channel_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_channel_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_channel_overrides_tenant_isolation ON business_channel_overrides;
CREATE POLICY business_channel_overrides_tenant_isolation ON business_channel_overrides
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- One active override per scope+feature+channel; branch_id nullable (see above).
CREATE UNIQUE INDEX IF NOT EXISTS business_channel_overrides_tenant_level_unique
  ON business_channel_overrides (tenant_id, feature, channel) WHERE branch_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_channel_overrides_branch_level_unique
  ON business_channel_overrides (tenant_id, branch_id, feature, channel) WHERE branch_id IS NOT NULL AND deleted_at IS NULL;
