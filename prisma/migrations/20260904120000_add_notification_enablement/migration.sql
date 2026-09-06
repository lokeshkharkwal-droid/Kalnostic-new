-- CreateEnum
CREATE TYPE "ChannelOverrideStatus" AS ENUM ('ACTIVE', 'DONT_SEND');

-- AlterTable: per-patient notification opt-out (legacy PatientPreferences.dont_send)
ALTER TABLE "patients" ADD COLUMN "notification_opt_out" JSONB;

-- CreateTable
CREATE TABLE "business_channel_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "is_email_channel_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_sms_channel_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_whatsapp_channel_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "business_channel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_channel_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "feature" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "status" "ChannelOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "business_channel_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_channel_settings_tenant_id_idx" ON "business_channel_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "business_channel_settings_branch_id_idx" ON "business_channel_settings"("branch_id");

-- CreateIndex
CREATE INDEX "business_channel_overrides_tenant_id_idx" ON "business_channel_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "business_channel_overrides_branch_id_idx" ON "business_channel_overrides"("branch_id");

-- CreateIndex
CREATE INDEX "business_channel_overrides_feature_idx" ON "business_channel_overrides"("feature");
