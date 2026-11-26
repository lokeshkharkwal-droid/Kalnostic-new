-- Subscription registration state on the tenant (mirrors the exchange_* columns).
-- Persists when a business was registered on the external Subscription server and
-- the client id/meta returned, so the SiteAdmin businesses list can show status and
-- the register flow is idempotent. Nullable, additive — no backfill required.
ALTER TABLE "tenants"
  ADD COLUMN "subscription_registered_at" TIMESTAMP(3),
  ADD COLUMN "subscription_client_id" TEXT,
  ADD COLUMN "subscription_registration_meta" JSONB;
