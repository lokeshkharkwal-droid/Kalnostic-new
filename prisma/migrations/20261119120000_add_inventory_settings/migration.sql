-- Business Settings › Inventory Settings. Tenant-scoped + tenant-level
-- (CLAUDE.md §4.6): one row per tenant, created on first read. Controls whether
-- inventory is auto-deducted at order creation and where manual inventory
-- adjustment is offered in Technician Reporting.
--
-- Table is `business_inventory_settings` (NOT `inventory_settings`): the inventory
-- app shares this database + public schema and already owns `inventory_settings`.

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'INVENTORY_SETTINGS';

-- CreateEnum
CREATE TYPE "InventoryManualAdjustmentMode" AS ENUM ('ORDER_TYPE', 'TEST_TYPE');

-- CreateTable
CREATE TABLE "business_inventory_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "is_automatic_inventory_reduction_enabled" BOOLEAN NOT NULL DEFAULT false,
    "manual_adjustment_mode" "InventoryManualAdjustmentMode" NOT NULL DEFAULT 'ORDER_TYPE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "business_inventory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_inventory_settings_tenant_id_key" ON "business_inventory_settings"("tenant_id");
CREATE INDEX "business_inventory_settings_tenant_id_idx" ON "business_inventory_settings"("tenant_id");

-- ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE "business_inventory_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_inventory_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_inventory_settings_tenant_isolation ON "business_inventory_settings";
CREATE POLICY business_inventory_settings_tenant_isolation ON "business_inventory_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
