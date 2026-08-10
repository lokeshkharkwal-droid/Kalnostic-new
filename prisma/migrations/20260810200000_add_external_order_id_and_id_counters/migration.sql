-- CreateEnum
CREATE TYPE "ExternalIdFormat" AS ENUM ('NONE', 'YMD_DAILY', 'BRANCH_YMD_DAILY', 'YMD_COMPACT_DAILY', 'YM_MONTHLY', 'BRANCH_YM_MONTHLY', 'Y_YEARLY', 'BRANCH_Y_YEARLY');

-- CreateEnum
CREATE TYPE "ExternalIdPurpose" AS ENUM ('ORDER', 'QUOTATION');

-- CreateEnum
CREATE TYPE "ExternalIdCounterType" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "external_order_id" TEXT;

-- AlterTable
ALTER TABLE "registration_settings" ADD COLUMN     "order_id_config_auto_increment_ext_order_id_format" "ExternalIdFormat" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "quotation_auto_increment_ext_quote_id_format" "ExternalIdFormat" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "external_id_counters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "purpose" "ExternalIdPurpose" NOT NULL,
    "counter_type" "ExternalIdCounterType" NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "last_reset_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_id_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_id_counters_tenant_id_idx" ON "external_id_counters"("tenant_id");

-- CreateIndex
CREATE INDEX "external_id_counters_branch_id_idx" ON "external_id_counters"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_id_counters_tenant_id_branch_id_purpose_counter_ty_key" ON "external_id_counters"("tenant_id", "branch_id", "purpose", "counter_type");

-- CreateIndex
CREATE INDEX "orders_branch_id_external_order_id_idx" ON "orders"("branch_id", "external_order_id");

