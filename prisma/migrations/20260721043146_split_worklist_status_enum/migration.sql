/*
  Warnings:

  - The `status` column on the `re_run_requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `scheduled_tests` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ActionWorklistStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "re_run_requests" DROP COLUMN "status",
ADD COLUMN     "status" "ActionWorklistStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "scheduled_tests" DROP COLUMN "status",
ADD COLUMN     "status" "ActionWorklistStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "re_run_requests_status_idx" ON "re_run_requests"("status");

-- CreateIndex
CREATE INDEX "scheduled_tests_status_idx" ON "scheduled_tests"("status");
