-- AlterTable: Exchange /clients registration state (platform-level, no RLS).
ALTER TABLE "tenants" ADD COLUMN "exchange_registered_at" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "exchange_client_id" TEXT;
ALTER TABLE "tenants" ADD COLUMN "exchange_registration_meta" JSONB;
