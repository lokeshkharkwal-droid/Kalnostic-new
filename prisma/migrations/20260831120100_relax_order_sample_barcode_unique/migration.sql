-- Grouping-aware barcode assignment (order / department / dept+sample per
-- Tenant.groupingMode) requires MULTIPLE active samples to share one barcode
-- value, so the per-tenant partial unique index on (tenant_id, barcode) must be
-- dropped. The plain "order_samples_barcode_idx" index (from the model's
-- @@index([barcode])) remains for lookups. Source of truth: prisma/rls.sql.
DROP INDEX IF EXISTS "order_samples_tenant_barcode_active_unique";
