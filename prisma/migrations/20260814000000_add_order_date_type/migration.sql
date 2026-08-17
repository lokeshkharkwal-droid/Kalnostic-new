-- CreateEnum
CREATE TYPE "OrderDateType" AS ENUM ('CURRENT', 'BACKTRACKED', 'ADVANCE_DATED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "order_date_type" "OrderDateType" NOT NULL DEFAULT 'CURRENT';
