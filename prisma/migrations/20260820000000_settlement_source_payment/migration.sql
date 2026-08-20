-- Re-grain the settlement source from ORDER to PAYMENT: each collected payment
-- (PaymentDetails row) is now its own settleable unit. The settlement feature is
-- not released, so clear existing settlement data (a per-order→per-payment backfill
-- is not well-defined) and replace settlement_source_orders with
-- settlement_source_payments.

-- Clear existing settlement data (dev; feature unreleased).
DELETE FROM "settlement_payments";
DELETE FROM "settlement_source_orders";
DELETE FROM "settlements";

-- DropTable
DROP TABLE "settlement_source_orders";

-- CreateTable
CREATE TABLE "settlement_source_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "settlement_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "collected_amount" INTEGER NOT NULL,
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "due_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "settlement_source_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_source_payments_tenant_id_idx" ON "settlement_source_payments"("tenant_id");
CREATE INDEX "settlement_source_payments_branch_id_idx" ON "settlement_source_payments"("branch_id");
CREATE INDEX "settlement_source_payments_settlement_id_idx" ON "settlement_source_payments"("settlement_id");
CREATE INDEX "settlement_source_payments_payment_id_idx" ON "settlement_source_payments"("payment_id");
CREATE INDEX "settlement_source_payments_order_id_idx" ON "settlement_source_payments"("order_id");
CREATE INDEX "settlement_source_payments_deleted_at_idx" ON "settlement_source_payments"("deleted_at");

-- AddForeignKey
ALTER TABLE "settlement_source_payments" ADD CONSTRAINT "settlement_source_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_source_payments" ADD CONSTRAINT "settlement_source_payments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_details"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_source_payments" ADD CONSTRAINT "settlement_source_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
