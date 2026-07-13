-- AlterTable
ALTER TABLE "branch_lab_tests" ALTER COLUMN "commission_price" DROP NOT NULL,
ALTER COLUMN "commission_price" DROP DEFAULT;

-- AlterTable
ALTER TABLE "branch_lab_panels" ALTER COLUMN "commission_price" DROP NOT NULL,
ALTER COLUMN "commission_price" DROP DEFAULT;
