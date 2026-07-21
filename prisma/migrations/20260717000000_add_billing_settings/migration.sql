-- CreateEnum
CREATE TYPE "BillingInvoiceResetCycle" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "GstMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "RefundApprovalLevel" AS ENUM ('COUNTER', 'MANAGER_ONLY', 'FINANCE_ONLY');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE IF NOT EXISTS 'BILLING_SETTINGS';

-- AlterEnum
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'CARD';
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'WALLET';
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV-',
    "next_invoice_number" INTEGER NOT NULL DEFAULT 1,
    "invoice_reset_cycle" "BillingInvoiceResetCycle" NOT NULL DEFAULT 'YEARLY',
    "receipt_footer" TEXT,
    "gst_mode" "GstMode" NOT NULL DEFAULT 'INCLUSIVE',
    "default_gst_percent" INTEGER NOT NULL DEFAULT 18,
    "counter_discount_max" INTEGER NOT NULL DEFAULT 10,
    "manager_discount_max" INTEGER NOT NULL DEFAULT 25,
    "is_approval_required_above_counter_limit" BOOLEAN NOT NULL DEFAULT true,
    "is_line_item_discount_allowed" BOOLEAN NOT NULL DEFAULT true,
    "is_cash_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_card_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_upi_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_wallet_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_bank_transfer_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_credit_b2b_enabled" BOOLEAN NOT NULL DEFAULT true,
    "refund_approval_level" "RefundApprovalLevel" NOT NULL DEFAULT 'MANAGER_ONLY',
    "refund_window_days" INTEGER NOT NULL DEFAULT 7,
    "is_credit_note_auto_generated_on_refund" BOOLEAN NOT NULL DEFAULT true,
    "is_refund_blocked_after_report_dispatch" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_settings_tenant_id_key" ON "billing_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_settings_tenant_id_idx" ON "billing_settings"("tenant_id");
