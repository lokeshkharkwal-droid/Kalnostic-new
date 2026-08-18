-- Row-Level Security for the invoice tables (mirrors prisma/rls.sql). Keeps DDL and
-- RLS separate, following the repo's row_level_security migration pattern. Applied by
-- `migrate deploy` so a fresh server gets tenant isolation + the invoice guards.

-- ── invoices ──────────────────────────────────────────────────────────────────
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_isolation ON "invoices";
CREATE POLICY invoices_tenant_isolation ON "invoices"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Invoice number unique per tenant among ACTIVE rows. A cancelled invoice is NOT
-- soft-deleted, so its number stays reserved and is never reused.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_no_active_unique
  ON "invoices" (tenant_id, invoice_no) WHERE deleted_at IS NULL;

-- ── invoice_source_orders ───────────────────────────────────────────────────────
ALTER TABLE "invoice_source_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_source_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_source_orders_tenant_isolation ON "invoice_source_orders";
CREATE POLICY invoice_source_orders_tenant_isolation ON "invoice_source_orders"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- An order may back at most one ACTIVE invoice link — the double-invoice guard.
-- Cancelling an invoice soft-deletes its links, which frees the order to be
-- invoiced again.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_source_orders_order_active_unique
  ON "invoice_source_orders" (tenant_id, order_id) WHERE deleted_at IS NULL;

-- ── invoice_payments ────────────────────────────────────────────────────────────
ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_payments_tenant_isolation ON "invoice_payments";
CREATE POLICY invoice_payments_tenant_isolation ON "invoice_payments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
