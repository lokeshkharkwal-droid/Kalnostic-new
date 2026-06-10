-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INDEPENDENT', 'UNDER_DEPARTMENT');

-- CreateEnum
CREATE TYPE "CategoryPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'CATEGORY';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "category_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_type" "CategoryType" NOT NULL,
    "department_id" TEXT,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "position" "CategoryPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "category_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenant_id_idx" ON "categories"("tenant_id");

-- CreateIndex
CREATE INDEX "categories_department_id_idx" ON "categories"("department_id");

-- CreateIndex
CREATE INDEX "categories_deleted_at_idx" ON "categories"("deleted_at");

-- CreateIndex
CREATE INDEX "category_person_mappings_tenant_id_idx" ON "category_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_category_id_idx" ON "category_person_mappings"("category_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_person_id_idx" ON "category_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "category_person_mappings_deleted_at_idx" ON "category_person_mappings"("deleted_at");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_person_mappings" ADD CONSTRAINT "category_person_mappings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
