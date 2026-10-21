-- Row-Level Security for the Technician Reporting table cluster (LabReport and everything that hangs off it).
-- These 13 tenant-scoped tables carry a required tenant_id but never had a policy, so tenant isolation for
-- them rested on application-level filtering alone (CLAUDE.md §4.3 requires a policy on every tenant-scoped
-- table). Mirrors the blocks added to prisma/rls.sql. Same tenant-isolation policy as every other tenant table
-- (e.g. tat_adjustments); tenant_id is NOT NULL on all 13, so no `OR tenant_id IS NULL` clause is needed.
-- Idempotent (DROP POLICY IF EXISTS / ENABLE / FORCE) and runs after 1_row_level_security, so
-- current_tenant_id() already exists.
--
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY; ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
--                       DROP POLICY <t>_tenant_isolation ON <t>;

-- ── lab_reports ──
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_reports_tenant_isolation ON lab_reports;
CREATE POLICY lab_reports_tenant_isolation ON lab_reports
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_result_values ──
ALTER TABLE lab_report_result_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_result_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_result_values_tenant_isolation ON lab_report_result_values;
CREATE POLICY lab_report_result_values_tenant_isolation ON lab_report_result_values
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_notes ──
ALTER TABLE lab_report_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_notes_tenant_isolation ON lab_report_notes;
CREATE POLICY lab_report_notes_tenant_isolation ON lab_report_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_attachments ──
ALTER TABLE lab_report_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_attachments_tenant_isolation ON lab_report_attachments;
CREATE POLICY lab_report_attachments_tenant_isolation ON lab_report_attachments
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_history ──
ALTER TABLE lab_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_history_tenant_isolation ON lab_report_history;
CREATE POLICY lab_report_history_tenant_isolation ON lab_report_history
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_overall_results ──
ALTER TABLE lab_report_overall_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_overall_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_overall_results_tenant_isolation ON lab_report_overall_results;
CREATE POLICY lab_report_overall_results_tenant_isolation ON lab_report_overall_results
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_report_inventory_usage ──
ALTER TABLE lab_report_inventory_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_report_inventory_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_report_inventory_usage_tenant_isolation ON lab_report_inventory_usage;
CREATE POLICY lab_report_inventory_usage_tenant_isolation ON lab_report_inventory_usage
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── re_run_requests ──
ALTER TABLE re_run_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE re_run_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS re_run_requests_tenant_isolation ON re_run_requests;
CREATE POLICY re_run_requests_tenant_isolation ON re_run_requests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── critical_alerts ──
ALTER TABLE critical_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE critical_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS critical_alerts_tenant_isolation ON critical_alerts;
CREATE POLICY critical_alerts_tenant_isolation ON critical_alerts
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── out_of_range_flags ──
ALTER TABLE out_of_range_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE out_of_range_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS out_of_range_flags_tenant_isolation ON out_of_range_flags;
CREATE POLICY out_of_range_flags_tenant_isolation ON out_of_range_flags
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── delta_checks ──
ALTER TABLE delta_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE delta_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delta_checks_tenant_isolation ON delta_checks;
CREATE POLICY delta_checks_tenant_isolation ON delta_checks
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── scheduled_tests ──
ALTER TABLE scheduled_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_tests_tenant_isolation ON scheduled_tests;
CREATE POLICY scheduled_tests_tenant_isolation ON scheduled_tests
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── multi_step_test_processes ──
ALTER TABLE multi_step_test_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE multi_step_test_processes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS multi_step_test_processes_tenant_isolation ON multi_step_test_processes;
CREATE POLICY multi_step_test_processes_tenant_isolation ON multi_step_test_processes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
