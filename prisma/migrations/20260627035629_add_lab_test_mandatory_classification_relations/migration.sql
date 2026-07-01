-- Clear orphaned mandatory classification refs (these columns were previously
-- logical refs and may hold placeholder ids that don't exist in the catalogue
-- tables) so the new foreign keys can be added.
--
-- An orphaned mandatory_dept_id can't satisfy both the new FK and the existing
-- chk_lab_test_mandatory_fields check (is_mandatory_test => mandatory_dept_id),
-- so for those rows clear the ref and drop the mandatory flag together.
UPDATE "lab_test"
SET "mandatory_dept_id" = NULL, "is_mandatory_test" = FALSE
WHERE "mandatory_dept_id" IS NOT NULL
  AND "mandatory_dept_id" NOT IN (SELECT "id" FROM "departments");

UPDATE "lab_test"
SET "mandatory_cat_id" = NULL
WHERE "mandatory_cat_id" IS NOT NULL
  AND "mandatory_cat_id" NOT IN (SELECT "id" FROM "categories");

UPDATE "lab_test"
SET "mandatory_subcat_id" = NULL
WHERE "mandatory_subcat_id" IS NOT NULL
  AND "mandatory_subcat_id" NOT IN (SELECT "id" FROM "sub_categories");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_dept_id_idx" ON "lab_test"("mandatory_dept_id");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_cat_id_idx" ON "lab_test"("mandatory_cat_id");

-- CreateIndex
CREATE INDEX "lab_test_mandatory_subcat_id_idx" ON "lab_test"("mandatory_subcat_id");

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_dept_id_fkey" FOREIGN KEY ("mandatory_dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_cat_id_fkey" FOREIGN KEY ("mandatory_cat_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_mandatory_subcat_id_fkey" FOREIGN KEY ("mandatory_subcat_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
