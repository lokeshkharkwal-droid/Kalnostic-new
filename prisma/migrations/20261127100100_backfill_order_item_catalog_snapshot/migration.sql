-- Best-effort backfill of order_items.catalog_snapshot for lines created before
-- the column existed (20261127100000_add_order_item_catalog_snapshot).
--
-- The charged price of those lines already lives in order_items.unit_price and is
-- NOT touched. Name/code/TAT/etc. were never stored, so they are copied from the
-- test/panel's CURRENT master data and the snapshot is flagged "backfilled": true
-- (history before this point is unrecoverable). Only non-direct, non-snapshotted
-- lines are touched, so the migration is idempotent. Soft-deleted master rows are
-- included deliberately: a line must still resolve its test after a sync removed it.
--
-- ROW-LEVEL SECURITY: order_items and the branch_lab_* tables have FORCE ROW
-- LEVEL SECURITY, so this runs once per tenant with app.current_tenant_id set the
-- way PrismaService.withTenant does, every statement filters on the tenant, and
-- the setting is cleared at the end. No ALTER TABLE here (see 20261009120000).

DO $backfill$
DECLARE
  t_id text;
  n bigint;
  total bigint := 0;
BEGIN
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    UPDATE "order_items" oi
       SET "catalog_snapshot" = jsonb_build_object(
             'v', 1,
             'kind', 'TEST',
             'backfilled', true,
             'capturedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'name', COALESCE(t."test_display_name", t."test_name"),
             'displayName', t."test_display_name",
             'code', t."test_code",
             'departmentId', t."department_id",
             'listId', t."list_id",
             'listPrice', t."list_price",
             'emergencyPrice', t."emergency_price",
             'priceMsrp', t."price_msrp",
             'isAllowDiscounts', t."is_allow_discounts",
             'tat', jsonb_build_object(
               'minValue', t."tat_min_value", 'minUnit', t."tat_min_unit",
               'maxValue', t."tat_max_value", 'maxUnit', t."tat_max_unit"),
             'schedule', jsonb_build_object(
               'days', to_jsonb(t."schedule_days"),
               'from', t."schedule_from", 'to', t."schedule_to")
           )
      FROM "branch_lab_tests" t
     WHERE oi."tenant_id" = t_id
       AND t."tenant_id" = t_id
       AND oi."branch_lab_test_id" = t."id"
       AND oi."catalog_snapshot" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    UPDATE "order_items" oi
       SET "catalog_snapshot" = jsonb_build_object(
             'v', 1,
             'kind', 'PANEL',
             'backfilled', true,
             'capturedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'name', p."panel_name",
             'code', p."panel_code",
             'departmentId', p."department_id",
             'listId', p."list_id",
             'listPrice', p."list_price",
             'priceMsrp', p."price_msrp",
             'isAllowDiscounts', NOT p."is_disable_discount",
             'tat', jsonb_build_object(
               'minValue', p."tat_min_value", 'minUnit', p."tat_min_unit",
               'maxValue', p."tat_max_value", 'maxUnit', p."tat_max_unit")
           )
      FROM "branch_lab_panels" p
     WHERE oi."tenant_id" = t_id
       AND p."tenant_id" = t_id
       AND oi."branch_lab_panel_id" = p."id"
       AND oi."catalog_snapshot" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;

  PERFORM set_config('app.current_tenant_id', '', true);
  RAISE NOTICE 'order_items.catalog_snapshot backfill: % line(s) snapshotted', total;
END
$backfill$;
