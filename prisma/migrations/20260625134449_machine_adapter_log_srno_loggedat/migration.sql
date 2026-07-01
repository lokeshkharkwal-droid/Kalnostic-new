-- AlterTable
ALTER TABLE "machine_adapter_logs" ADD COLUMN     "logged_at" TIMESTAMP(3),
ADD COLUMN     "sr_no" INTEGER;

-- AlterTable
ALTER TABLE "machine_test_mappings" ALTER COLUMN "decimal_places" SET DEFAULT 2;
