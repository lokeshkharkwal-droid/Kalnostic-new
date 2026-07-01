-- Clear orphaned classification refs (these columns were previously logical
-- refs and may hold placeholder ids that don't exist in the catalogue tables)
-- so the new foreign keys can be added. Unlike mandatory_dept_id, the
-- classification columns aren't gated by a CHECK constraint, so nulling is safe.
UPDATE "lab_test"
SET "department_id" = NULL
WHERE "department_id" IS NOT NULL
  AND "department_id" NOT IN (SELECT "id" FROM "departments");

UPDATE "lab_test"
SET "category_id" = NULL
WHERE "category_id" IS NOT NULL
  AND "category_id" NOT IN (SELECT "id" FROM "categories");

UPDATE "lab_test"
SET "sub_category_id" = NULL
WHERE "sub_category_id" IS NOT NULL
  AND "sub_category_id" NOT IN (SELECT "id" FROM "sub_categories");

-- CreateIndex
CREATE INDEX "lab_test_sub_category_id_idx" ON "lab_test"("sub_category_id");

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test" ADD CONSTRAINT "lab_test_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
