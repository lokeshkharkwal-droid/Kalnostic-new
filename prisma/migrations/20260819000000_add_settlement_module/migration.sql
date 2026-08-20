-- CreateEnum
CREATE TYPE "SettlementPartyType" AS ENUM ('B2B', 'REFERRED_BY', 'INTERNAL_REFERRAL_USER', 'EXTERNAL_REFERRAL_USER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_SETTLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "SettlementPayoutMode" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'SETTLEMENT';

-- AlterTable
ALTER TABLE "billing_settings" ADD COLUMN     "settlement_prefix" TEXT NOT NULL DEFAULT 'STL-',
ADD COLUMN     "next_settlement_number" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "settlement_no" TEXT NOT NULL,
    "settlement_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "party_type" "SettlementPartyType" NOT NULL,
    "party_id" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "party_mobile" TEXT,
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "due_amount" INTEGER NOT NULL DEFAULT 0,
    "approved_amount" INTEGER NOT NULL DEFAULT 0,
    "settled_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "decision_notes" TEXT,
    "decision_attachment_url" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_source_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "settlement_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "collected_amount" INTEGER NOT NULL,
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "due_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "settlement_source_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "settlement_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "payout_mode" "SettlementPayoutMode" NOT NULL,
    "reference" TEXT NOT NULL,
    "attachment_url" TEXT,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "settlement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlements_tenant_id_idx" ON "settlements"("tenant_id");

-- CreateIndex
CREATE INDEX "settlements_branch_id_idx" ON "settlements"("branch_id");

-- CreateIndex
CREATE INDEX "settlements_party_type_party_id_idx" ON "settlements"("party_type", "party_id");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlements_settlement_no_idx" ON "settlements"("settlement_no");

-- CreateIndex
CREATE INDEX "settlements_deleted_at_idx" ON "settlements"("deleted_at");

-- CreateIndex
CREATE INDEX "settlement_source_orders_tenant_id_idx" ON "settlement_source_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "settlement_source_orders_branch_id_idx" ON "settlement_source_orders"("branch_id");

-- CreateIndex
CREATE INDEX "settlement_source_orders_settlement_id_idx" ON "settlement_source_orders"("settlement_id");

-- CreateIndex
CREATE INDEX "settlement_source_orders_order_id_idx" ON "settlement_source_orders"("order_id");

-- CreateIndex
CREATE INDEX "settlement_source_orders_deleted_at_idx" ON "settlement_source_orders"("deleted_at");

-- CreateIndex
CREATE INDEX "settlement_payments_tenant_id_idx" ON "settlement_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "settlement_payments_branch_id_idx" ON "settlement_payments"("branch_id");

-- CreateIndex
CREATE INDEX "settlement_payments_settlement_id_idx" ON "settlement_payments"("settlement_id");

-- CreateIndex
CREATE INDEX "settlement_payments_deleted_at_idx" ON "settlement_payments"("deleted_at");

-- AddForeignKey
ALTER TABLE "settlement_source_orders" ADD CONSTRAINT "settlement_source_orders_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_source_orders" ADD CONSTRAINT "settlement_source_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
