/*
  Warnings:

  - Made the column `code` on table `branches` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "ShiftName" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');

-- AlterTable
ALTER TABLE "branches" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "operational_days" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "branch_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tenant_main_branch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_main_branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "shifts" JSONB NOT NULL,
    "active_days" JSONB NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_main_branch_tenant_id_key" ON "tenant_main_branch"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_main_branch_branch_id_idx" ON "tenant_main_branch"("branch_id");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_idx" ON "schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "schedules_branch_id_idx" ON "schedules"("branch_id");

-- CreateIndex
CREATE INDEX "schedules_deleted_at_idx" ON "schedules"("deleted_at");
