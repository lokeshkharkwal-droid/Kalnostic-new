-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "source_quotation_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_source_quotation_id_idx" ON "orders"("source_quotation_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
