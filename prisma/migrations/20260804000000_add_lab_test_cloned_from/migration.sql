-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "cloned_from_id" TEXT,
ADD COLUMN     "template_synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "lab_test_cloned_from_id_idx" ON "lab_test"("cloned_from_id");
