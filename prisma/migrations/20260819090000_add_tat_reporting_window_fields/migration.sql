-- Reporting window (SRS "Copy of Turnaround Time" §5.4) + Approval duration
-- (SRS §5.5) on lab_test / branch_lab_tests, and the reporting-cutoff deferral
-- flag on lab_reports. See tat_adjustment.dto.ts / tat.service.ts for the
-- consuming logic.

-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "reporting_time_from" TEXT,
ADD COLUMN     "reporting_time_to" TEXT,
ADD COLUMN     "approval_duration_min_value" INTEGER,
ADD COLUMN     "approval_duration_min_unit" "TatUnit",
ADD COLUMN     "approval_duration_max_value" INTEGER,
ADD COLUMN     "approval_duration_max_unit" "TatUnit";

-- AlterTable
ALTER TABLE "branch_lab_tests" ADD COLUMN     "reporting_time_from" TEXT,
ADD COLUMN     "reporting_time_to" TEXT,
ADD COLUMN     "approval_duration_min_value" INTEGER,
ADD COLUMN     "approval_duration_min_unit" "TatUnit",
ADD COLUMN     "approval_duration_max_value" INTEGER,
ADD COLUMN     "approval_duration_max_unit" "TatUnit";

-- AlterTable
ALTER TABLE "lab_reports" ADD COLUMN     "reporting_deferred_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "technician_settings" ADD COLUMN     "tat_adjustment_reasons" TEXT[] DEFAULT ARRAY['QC Failure', 'Instrument Issue', 'Calibration Failure', 'Other']::TEXT[];
