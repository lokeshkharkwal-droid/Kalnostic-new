-- AlterTable: integer id sent to the Exchange server as peer_tenant_id.
ALTER TABLE "tenants" ADD COLUMN "exchange_tenant_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_exchange_tenant_id_key" ON "tenants"("exchange_tenant_id");

-- CreateTable: platform-level monotonic counters (no RLS).
CREATE TABLE "platform_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_counters_pkey" PRIMARY KEY ("key")
);

-- Seed the Exchange tenant-id counter row (value 0 = nothing allocated yet).
INSERT INTO "platform_counters" ("key", "value", "updated_at")
VALUES ('exchange_tenant_id', 0, NOW());
