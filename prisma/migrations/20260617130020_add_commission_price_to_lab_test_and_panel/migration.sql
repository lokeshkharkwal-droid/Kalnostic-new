-- AlterTable
ALTER TABLE "lab_panels" ADD COLUMN     "commission_price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "commission_price" INTEGER NOT NULL DEFAULT 0;
