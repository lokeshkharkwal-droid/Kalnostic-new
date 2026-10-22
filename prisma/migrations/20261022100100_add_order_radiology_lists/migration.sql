-- Record which radiology pricing lists an order drew its radiology items + prices
-- from, parallel to the existing branch_lab_test_list_id / branch_lab_panel_list_id
-- provenance columns. Nullable (null = none resolved / no radiology on the order).
-- Covered by the existing `orders` RLS policy.
ALTER TABLE "orders" ADD COLUMN "branch_radiology_test_list_id" TEXT;
ALTER TABLE "orders" ADD COLUMN "branch_radiology_panel_list_id" TEXT;
