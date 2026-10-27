-- Parent/child sub-order model for combined (diagnostic + radiology) orders.
-- A combined registration is stored as a PARENT order (identity + main
-- order_code, no items/payments) plus two CHILD orders (one per `section`).
-- Single-section orders stay STANDALONE. Existing rows default to STANDALONE.

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('STANDALONE', 'PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "OrderSection" AS ENUM ('DIAGNOSTICS', 'RADIOLOGY', 'OPD');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "order_kind" "OrderKind" NOT NULL DEFAULT 'STANDALONE',
ADD COLUMN     "parent_order_id" TEXT,
ADD COLUMN     "section" "OrderSection";

-- CreateIndex
CREATE INDEX "orders_order_kind_idx" ON "orders"("order_kind");

-- CreateIndex
CREATE INDEX "orders_parent_order_id_idx" ON "orders"("parent_order_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
