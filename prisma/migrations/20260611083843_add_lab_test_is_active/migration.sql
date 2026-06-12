-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "lab_test_is_active_idx" ON "lab_test"("is_active");
