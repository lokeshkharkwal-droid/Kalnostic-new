-- Persist a Registration Settings PT Category on a patient (branch-level pricing
-- category). Nullable FK to pt_categories; validated against the active branch in
-- the service. The legacy patient_category enum column is left untouched.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "pt_category_id" TEXT;

-- CreateIndex
CREATE INDEX "patients_pt_category_id_idx" ON "patients"("pt_category_id");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_pt_category_id_fkey" FOREIGN KEY ("pt_category_id") REFERENCES "pt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
