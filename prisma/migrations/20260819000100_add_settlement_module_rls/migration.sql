-- Row-Level Security for the settlement tables (mirrors prisma/rls.sql). Keeps DDL
-- and RLS separate, following the repo's row_level_security migration pattern.
-- Applied by `migrate deploy` so a fresh server gets tenant isolation + the
-- settlement guards.

-- ── settlements ─────────────────────────────────────────────────────────────────
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlements_tenant_isolation ON "settlements";
CREATE POLICY settlements_tenant_isolation ON "settlements"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Settlement number unique per tenant among ACTIVE rows.
CREATE UNIQUE INDEX IF NOT EXISTS settlements_tenant_no_active_unique
  ON "settlements" (tenant_id, settlement_no) WHERE deleted_at IS NULL;

-- ── settlement_source_orders ────────────────────────────────────────────────────
ALTER TABLE "settlement_source_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_source_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_source_orders_tenant_isolation ON "settlement_source_orders";
CREATE POLICY settlement_source_orders_tenant_isolation ON "settlement_source_orders"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- An order may back at most one ACTIVE settlement link — the double-settlement guard.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_source_orders_order_active_unique
  ON "settlement_source_orders" (tenant_id, order_id) WHERE deleted_at IS NULL;

-- ── settlement_payments ─────────────────────────────────────────────────────────
ALTER TABLE "settlement_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_payments_tenant_isolation ON "settlement_payments";
CREATE POLICY settlement_payments_tenant_isolation ON "settlement_payments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
