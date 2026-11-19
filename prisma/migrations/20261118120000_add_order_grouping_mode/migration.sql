-- Per-order Accession grouping mode.
--
-- Why: the grouping mode used to be ONE tenant-wide setting that every screen and the
-- Collect barcode rule read live, and changing it wiped every barcode of the tenant
-- (Accession Settings -> Save). Barcodes are on printed labels, in transfers to other
-- branches and matched by the lab analyzers, so they must never be cleared by a
-- settings change, and an order must keep the grouping its barcodes were made under.
--
-- Now each order carries its own mode. It is decided once, when the order first gets
-- samples (taken from the tenant's mode under the tenant row lock), and never changed.
-- NULL means "not decided yet" (a draft / quote / appointment with no samples); such an
-- order follows the tenant's current mode until its first sample or barcode is made.
-- The tenant column stays: it is the mode NEW orders take.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "grouping_mode" "AccessionGroupingMode";

-- Backfill: every order that already has samples gets its tenant's CURRENT mode.
-- Exact, not a guess, only because no tenant has ever switched its mode in production
-- (so every existing order was grouped under the mode the tenant still has). Orders with
-- no samples stay NULL. `orders` is FORCE ROW LEVEL SECURITY, so each tenant is handled
-- under its own tenant context (same pattern as the barcode_before_repeat backfill).
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id, grouping_mode FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', t.id, true);
    UPDATE orders o
       SET grouping_mode = t.grouping_mode
     WHERE o.tenant_id = t.id
       AND o.grouping_mode IS NULL
       AND EXISTS (
         SELECT 1
           FROM order_samples s
          WHERE s.order_id = o.id
            AND s.tenant_id = t.id
            AND s.deleted_at IS NULL
       );
  END LOOP;
END $$;

-- Immutability: once an order has a mode it can never change (NULL -> value is allowed,
-- value -> anything else is refused). Done in the database so no code path, script or
-- manual update can regroup an order whose barcodes are already out in the world.
CREATE OR REPLACE FUNCTION orders_grouping_mode_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.grouping_mode IS NOT NULL
     AND NEW.grouping_mode IS DISTINCT FROM OLD.grouping_mode THEN
    RAISE EXCEPTION 'orders.grouping_mode is immutable once set (order %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_grouping_mode_immutable ON "orders";
CREATE TRIGGER orders_grouping_mode_immutable
  BEFORE UPDATE OF "grouping_mode" ON "orders"
  FOR EACH ROW
  EXECUTE FUNCTION orders_grouping_mode_immutable();
