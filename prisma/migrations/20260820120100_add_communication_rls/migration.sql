-- Row-Level Security for the new communication tables — mirrors the blocks added
-- to prisma/rls.sql. Tenant-isolation policies keyed on tenant_id (CLAUDE.md §4.3).
-- Idempotent (DROP IF EXISTS / FORCE), and runs after 1_row_level_security so
-- current_tenant_id() already exists.

-- ── communication_logs ──
ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS communication_logs_tenant_isolation ON communication_logs;
CREATE POLICY communication_logs_tenant_isolation ON communication_logs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── notifications ──
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── notification_actors ──
ALTER TABLE notification_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_actors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_actors_tenant_isolation ON notification_actors;
CREATE POLICY notification_actors_tenant_isolation ON notification_actors
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── notification_targets ──
ALTER TABLE notification_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_targets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_targets_tenant_isolation ON notification_targets;
CREATE POLICY notification_targets_tenant_isolation ON notification_targets
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
