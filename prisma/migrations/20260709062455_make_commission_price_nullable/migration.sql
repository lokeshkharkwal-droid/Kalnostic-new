-- AlterTable
ALTER TABLE "lab_panels" ALTER COLUMN "commission_price" DROP NOT NULL,
ALTER COLUMN "commission_price" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lab_test" ALTER COLUMN "commission_price" DROP NOT NULL,
ALTER COLUMN "commission_price" DROP DEFAULT;
