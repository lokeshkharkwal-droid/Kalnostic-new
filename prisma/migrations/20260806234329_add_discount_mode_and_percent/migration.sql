-- CreateEnum
CREATE TYPE "DiscountMode" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "lab_panel_tests" ADD COLUMN     "discount_percent" INTEGER;

-- AlterTable
ALTER TABLE "branch_lab_panel_tests" ADD COLUMN     "discount_percent" INTEGER;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "discount_mode" "DiscountMode",
ADD COLUMN     "discount_value" INTEGER;
