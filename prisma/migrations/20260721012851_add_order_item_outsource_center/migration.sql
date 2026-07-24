-- AlterTable
ALTER TABLE "lab_reports" ADD COLUMN     "is_outsourced" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "outsource_center_id" TEXT;

-- CreateIndex
CREATE INDEX "lab_reports_is_outsourced_idx" ON "lab_reports"("is_outsourced");

-- CreateIndex
CREATE INDEX "order_items_outsource_center_id_idx" ON "order_items"("outsource_center_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
