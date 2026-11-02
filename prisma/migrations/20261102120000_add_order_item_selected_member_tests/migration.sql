-- Partial lab-panel ordering: a panel order line can run only a chosen subset of
-- its member tests while still billing the full panel price. Records the selected
-- members as their BranchLabTest ids (matching branch_lab_panel_tests.branch_lab_test_id).
-- EMPTY array = all members (the default + backward-compatible behaviour for every
-- line created before this feature). Only the listed members are expanded into
-- OrderSamples / LabReports downstream; pricing/billing is unaffected.

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "selected_member_branch_lab_test_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
