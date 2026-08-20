-- Row-Level Security for settlement_source_payments (mirrors prisma/rls.sql). The
-- old settlement_source_orders table (and its policy) was dropped by the prior
-- migration. No unique index — a payment may back multiple active links (partial
-- re-settlement); eligibility is the remaining amount, computed in the service.

ALTER TABLE "settlement_source_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_source_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_source_payments_tenant_isolation ON "settlement_source_payments";
CREATE POLICY settlement_source_payments_tenant_isolation ON "settlement_source_payments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
