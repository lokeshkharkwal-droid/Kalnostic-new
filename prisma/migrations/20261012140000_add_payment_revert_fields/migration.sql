-- Single-payment revert markers for the Finance → Payments ledger.
-- A reverted payment row stays ACTIVE (`deleted_at` NULL) so its `net_amount`
-- snapshot still counts toward the order's net total (net is summed across payment
-- rows), but its money fields are zeroed so it contributes no collected money.
-- `reverted_amount` preserves the original figure for the "Reverted" tab;
-- `reverted_at` flags the row so money sums and display paths can exclude it. Both
-- tables are already RLS-scoped on `tenant_id`; adding columns needs no policy change.

-- AlterTable
ALTER TABLE "payment_details" ADD COLUMN     "reverted_at" TIMESTAMP(3),
ADD COLUMN     "reverted_by" TEXT,
ADD COLUMN     "revert_reason" TEXT,
ADD COLUMN     "reverted_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_payments" ADD COLUMN     "reverted_at" TIMESTAMP(3),
ADD COLUMN     "reverted_by" TEXT,
ADD COLUMN     "revert_reason" TEXT,
ADD COLUMN     "reverted_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "payment_details_reverted_at_idx" ON "payment_details"("reverted_at");

-- CreateIndex
CREATE INDEX "invoice_payments_reverted_at_idx" ON "invoice_payments"("reverted_at");
