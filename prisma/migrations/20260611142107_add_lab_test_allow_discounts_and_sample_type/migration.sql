-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "is_allow_discounts" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "lab_test_samples" ADD COLUMN     "sample_type" TEXT;
