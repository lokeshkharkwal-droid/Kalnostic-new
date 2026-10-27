-- Radiology order items set branch_radiology_test_id / branch_radiology_panel_id
-- instead of the lab refs, so the old lab-only "exactly one" check rejected
-- every radiology order. Widen it to cover all five sources.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_source_exactly_one;
ALTER TABLE order_items ADD CONSTRAINT order_items_source_exactly_one
  CHECK (
      (CASE WHEN branch_lab_test_id          IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN branch_lab_panel_id         IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN branch_radiology_test_id    IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN branch_radiology_panel_id   IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN direct                      IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
