-- Snapshot of the catalogue test/panel on each order line (name, code, prices,
-- TAT, ...), so master-data edits/syncs never alter an existing order. See
-- OrderItem.catalogSnapshot in schema.prisma. Nullable, no default: existing rows
-- are filled by the separate data-only migration
-- 20261127100100_backfill_order_item_catalog_snapshot, so this DDL's lock is
-- released before the slower backfill runs. order_items' existing tenant RLS
-- policy covers the new column; no rls.sql change is needed.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "catalog_snapshot" JSONB;
