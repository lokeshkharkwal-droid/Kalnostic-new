-- CreateEnum
CREATE TYPE "SubCategoryType" AS ENUM ('INDEPENDENT', 'UNDER_DEPARTMENT', 'UNDER_CATEGORY');

-- CreateEnum
CREATE TYPE "SubCategoryPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'SUB_CATEGORY';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sub_category_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sub_category_type" "SubCategoryType" NOT NULL,
    "department_id" TEXT,
    "category_id" TEXT,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_category_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sub_category_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "position" "SubCategoryPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sub_category_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sub_categories_tenant_id_idx" ON "sub_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "sub_categories_department_id_idx" ON "sub_categories"("department_id");

-- CreateIndex
CREATE INDEX "sub_categories_category_id_idx" ON "sub_categories"("category_id");

-- CreateIndex
CREATE INDEX "sub_categories_deleted_at_idx" ON "sub_categories"("deleted_at");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_tenant_id_idx" ON "sub_category_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_sub_category_id_idx" ON "sub_category_person_mappings"("sub_category_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_person_id_idx" ON "sub_category_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "sub_category_person_mappings_deleted_at_idx" ON "sub_category_person_mappings"("deleted_at");

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_category_person_mappings" ADD CONSTRAINT "sub_category_person_mappings_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
