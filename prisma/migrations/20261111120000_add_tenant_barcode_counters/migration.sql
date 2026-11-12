-- Tenant-wide barcode counters (order + sample barcodes).
--
-- Why: order/sample barcodes must be unique across ALL of a tenant's branches,
-- but each branch kept its own counter (AccessionSetting.*_CurrentNumber) and
-- skipped numbers other branches had used, one number at a time. A quiet branch
-- that fell ~1,800 numbers behind (DIAGNOSTICS-BHAINSA, 2026-11-07) could no
-- longer finish that walk inside the 5 s order transaction, so every order it
-- tried to create failed with a 500. The number now comes from one counter row
-- per (tenant, kind), incremented atomically; branches keep only the format.
--
-- Steps (the only step that can fail on existing data runs first, so a failure
-- leaves the database untouched):
--   1. Enforce order-barcode uniqueness per TENANT (was per branch).
--   2. Create the counter table.
--   3. Start each tenant's counters above every number already issued.
--   4. Retire per-branch reset cycles (incompatible with tenant-wide numbers).
--   5. Row-Level Security for the new table (mirrors prisma/rls.sql).

-- 1. Tenant-wide unique order barcode among active orders. Replaces the
--    per-branch unique key; mirrored in prisma/rls.sql (partial index).
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_order_barcode_active_unique
  ON "orders" ("tenant_id", "order_id_barcode") WHERE "deleted_at" IS NULL;

-- DropIndex
DROP INDEX IF EXISTS "orders_branch_id_order_id_barcode_key";

-- 2. CreateEnum
CREATE TYPE "BarcodeCounterKind" AS ENUM ('ORDER', 'SAMPLE');

-- CreateTable
CREATE TABLE "tenant_barcode_counters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "BarcodeCounterKind" NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_barcode_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_barcode_counters_tenant_id_kind_key" ON "tenant_barcode_counters"("tenant_id", "kind");

-- 3. Starting values: the highest number any branch of the tenant has issued.
--    A branch's old counter always equals the last number it issued, and plain
--    numeric barcodes are included as a cross-check (all live barcodes use the
--    default format). Floor 10000, so the next number is at least 10001. A value
--    issued in another format, or by a request still running on the old code
--    during the deploy, is caught at runtime: BarcodeService checks every new
--    number and skips past any already in use.
INSERT INTO "tenant_barcode_counters" ("id", "tenant_id", "kind", "current_number", "created_at", "updated_at")
SELECT gen_random_uuid()::text, used.tenant_id, 'ORDER'::"BarcodeCounterKind",
       GREATEST(10000, MAX(used.n)), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT "tenant_id", "order_barcode_settings_current_number"::bigint AS n
  FROM "accession_settings"
  UNION ALL
  SELECT "tenant_id", "order_id_barcode"::bigint
  FROM "orders"
  WHERE "order_id_barcode" ~ '^[0-9]{1,9}$'
) used
GROUP BY used.tenant_id
ON CONFLICT ("tenant_id", "kind") DO UPDATE
  SET "current_number" = GREATEST("tenant_barcode_counters"."current_number", EXCLUDED."current_number");

INSERT INTO "tenant_barcode_counters" ("id", "tenant_id", "kind", "current_number", "created_at", "updated_at")
SELECT gen_random_uuid()::text, used.tenant_id, 'SAMPLE'::"BarcodeCounterKind",
       GREATEST(10000, MAX(used.n)), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT "tenant_id", "sample_barcode_settings_current_number"::bigint AS n
  FROM "accession_settings"
  UNION ALL
  SELECT "tenant_id", "barcode"::bigint
  FROM "order_samples"
  WHERE "barcode" ~ '^[0-9]{1,9}$'
) used
GROUP BY used.tenant_id
ON CONFLICT ("tenant_id", "kind") DO UPDATE
  SET "current_number" = GREATEST("tenant_barcode_counters"."current_number", EXCLUDED."current_number");

-- 4. Barcode numbers never reset any more (a reset would re-issue numbers
--    already printed on orders/samples). The columns stay for older clients.
UPDATE "accession_settings"
SET "order_barcode_settings_reset_interval" = 'NEVER'
WHERE "order_barcode_settings_reset_interval" <> 'NEVER';

UPDATE "accession_settings"
SET "sample_barcode_settings_reset_interval" = 'NEVER'
WHERE "sample_barcode_settings_reset_interval" <> 'NEVER';

-- 5. ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE "tenant_barcode_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_barcode_counters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_barcode_counters_tenant_isolation ON "tenant_barcode_counters";
CREATE POLICY tenant_barcode_counters_tenant_isolation ON "tenant_barcode_counters"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
