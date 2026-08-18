-- CreateEnum
CREATE TYPE "InvoicePartyType" AS ENUM ('B2B', 'REFERRED_BY', 'INTERNAL_REFERRAL_USER', 'EXTERNAL_REFERRAL_USER');

-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceDueStatus" AS ENUM ('ON_TIME', 'OVERDUE');

-- CreateEnum
CREATE TYPE "InvoicePaymentFor" AS ENUM ('INVOICE', 'TDS');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'INVOICE';

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoice_due_date" TIMESTAMP(3) NOT NULL,
    "party_type" "InvoicePartyType" NOT NULL,
    "party_id" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "party_mobile" TEXT,
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds_percent" INTEGER NOT NULL DEFAULT 0,
    "tds_amount" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_invoice" INTEGER NOT NULL DEFAULT 0,
    "paid_tds" INTEGER NOT NULL DEFAULT 0,
    "outstanding_invoice" INTEGER NOT NULL DEFAULT 0,
    "outstanding_tds" INTEGER NOT NULL DEFAULT 0,
    "tds_due_date" TIMESTAMP(3),
    "notes" TEXT,
    "payment_status" "InvoicePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "due_status" "InvoiceDueStatus" NOT NULL DEFAULT 'ON_TIME',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_source_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "invoice_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "invoiced_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoice_source_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "invoice_id" TEXT NOT NULL,
    "payment_for" "InvoicePaymentFor" NOT NULL,
    "amount" INTEGER NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL,
    "reference" TEXT NOT NULL,
    "attachment_url" TEXT,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_branch_id_idx" ON "invoices"("branch_id");

-- CreateIndex
CREATE INDEX "invoices_party_type_party_id_idx" ON "invoices"("party_type", "party_id");

-- CreateIndex
CREATE INDEX "invoices_payment_status_idx" ON "invoices"("payment_status");

-- CreateIndex
CREATE INDEX "invoices_due_status_idx" ON "invoices"("due_status");

-- CreateIndex
CREATE INDEX "invoices_invoice_no_idx" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_deleted_at_idx" ON "invoices"("deleted_at");

-- CreateIndex
CREATE INDEX "invoice_source_orders_tenant_id_idx" ON "invoice_source_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_source_orders_branch_id_idx" ON "invoice_source_orders"("branch_id");

-- CreateIndex
CREATE INDEX "invoice_source_orders_invoice_id_idx" ON "invoice_source_orders"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_source_orders_order_id_idx" ON "invoice_source_orders"("order_id");

-- CreateIndex
CREATE INDEX "invoice_source_orders_deleted_at_idx" ON "invoice_source_orders"("deleted_at");

-- CreateIndex
CREATE INDEX "invoice_payments_tenant_id_idx" ON "invoice_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_payments_branch_id_idx" ON "invoice_payments"("branch_id");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payments_payment_for_idx" ON "invoice_payments"("payment_for");

-- CreateIndex
CREATE INDEX "invoice_payments_deleted_at_idx" ON "invoice_payments"("deleted_at");

-- AddForeignKey
ALTER TABLE "invoice_source_orders" ADD CONSTRAINT "invoice_source_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_source_orders" ADD CONSTRAINT "invoice_source_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
