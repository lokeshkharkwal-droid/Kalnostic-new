-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable: drop superseded columns
ALTER TABLE "branches" DROP COLUMN "address";
ALTER TABLE "branches" DROP COLUMN "is_active";

-- AlterTable: add new branch fields
ALTER TABLE "branches"
  ADD COLUMN "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "established_date" TIMESTAMP(3),
  ADD COLUMN "address_line" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "pincode" TEXT,
  ADD COLUMN "manager_name" TEXT,
  ADD COLUMN "manager_phone" TEXT,
  ADD COLUMN "lab_director" TEXT,
  ADD COLUMN "opening_time" TEXT,
  ADD COLUMN "closing_time" TEXT,
  ADD COLUMN "daily_capacity" INTEGER,
  ADD COLUMN "operational_days" "DayOfWeek"[] DEFAULT ARRAY[]::"DayOfWeek"[],
  ADD COLUMN "gst_no" TEXT,
  ADD COLUMN "license_no" TEXT,
  ADD COLUMN "remarks" TEXT;
