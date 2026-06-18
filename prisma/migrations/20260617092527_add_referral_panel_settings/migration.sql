-- CreateEnum
CREATE TYPE "ReferralPanelSettingsStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReferralBonusType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'REFERRAL_PANEL_SETTINGS';

-- AlterTable
ALTER TABLE "external_referrals" ADD COLUMN     "referral_panel_settings_id" TEXT;

-- AlterTable
ALTER TABLE "internal_referrals" ADD COLUMN     "referral_panel_settings_id" TEXT;

-- AlterTable
ALTER TABLE "referral_doctors" ADD COLUMN     "referral_panel_settings_id" TEXT;

-- CreateTable
CREATE TABLE "referral_panel_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "setting_name" TEXT NOT NULL,
    "client_type" "ReferralClientType" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReferralPanelSettingsStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_send_bills_to_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_send_bills_to_b2b" BOOLEAN NOT NULL DEFAULT false,
    "is_send_bills_to_doctor" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_patient" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_b2b" BOOLEAN NOT NULL DEFAULT false,
    "is_send_reports_to_doctor" BOOLEAN NOT NULL DEFAULT false,
    "credit_limit_amount" DECIMAL(12,2),
    "is_restrict_order_credit_limit" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_credit_limit" BOOLEAN NOT NULL DEFAULT false,
    "credit_allowed_days" INTEGER,
    "is_restrict_order_credit_days" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_credit_days" BOOLEAN NOT NULL DEFAULT false,
    "days_after_invoice" INTEGER,
    "is_restrict_order_post_invoice" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_post_invoice" BOOLEAN NOT NULL DEFAULT false,
    "is_auto_invoice" BOOLEAN NOT NULL DEFAULT false,
    "raise_invoice_credit_limit" DECIMAL(12,2),
    "invoice_frequency_days" INTEGER,
    "is_overlap_month_end_close" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_manual_invoice" BOOLEAN NOT NULL DEFAULT false,
    "invoice_email_trigger_hours" INTEGER,
    "min_wallet_advance" DECIMAL(12,2),
    "min_advance_for_bonus" DECIMAL(12,2),
    "min_wallet_balance" DECIMAL(12,2),
    "is_restrict_order_at_min_balance" BOOLEAN NOT NULL DEFAULT false,
    "is_reminder_at_75_percent" BOOLEAN NOT NULL DEFAULT false,
    "is_reminder_at_min_balance" BOOLEAN NOT NULL DEFAULT false,
    "bonus_type" "ReferralBonusType",
    "bonus_percentage" DECIMAL(5,2),
    "bonus_fixed_amount" DECIMAL(12,2),
    "bonus_extra_amount" DECIMAL(12,2),
    "is_allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    "max_negative_balance" DECIMAL(12,2),
    "is_restrict_order_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_restrict_report_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_other_payment_modes" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_panel_settings_tenant_id_idx" ON "referral_panel_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_settings_branch_id_idx" ON "referral_panel_settings"("branch_id");

-- CreateIndex
CREATE INDEX "referral_panel_settings_client_type_idx" ON "referral_panel_settings"("client_type");

-- CreateIndex
CREATE INDEX "referral_panel_settings_deleted_at_idx" ON "referral_panel_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referrals_referral_panel_settings_id_idx" ON "external_referrals"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "internal_referrals_referral_panel_settings_id_idx" ON "internal_referrals"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "referral_doctors_referral_panel_settings_id_idx" ON "referral_doctors"("referral_panel_settings_id");

-- CreateIndex
CREATE INDEX "referral_panels_referral_panel_settings_id_idx" ON "referral_panels"("referral_panel_settings_id");

-- AddForeignKey
ALTER TABLE "referral_panels" ADD CONSTRAINT "referral_panels_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_referrals" ADD CONSTRAINT "external_referrals_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referrals" ADD CONSTRAINT "internal_referrals_referral_panel_settings_id_fkey" FOREIGN KEY ("referral_panel_settings_id") REFERENCES "referral_panel_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
