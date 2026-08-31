-- Technician Reporting: per-workflow status vocabularies.
--
-- Replaces the three old worklist status enums with three new ones matching the
-- business spec, remapping every existing row to its nearest new equivalent so
-- no in-flight worklist entry loses its progress (a plain enum cast would fail /
-- drop data). One shared enum (AlertReviewStatus) now backs Critical Alerts,
-- Out of Range, and Delta Check, which share an identical vocabulary.
--
--   WorklistStatus       -> AlertReviewStatus (critical_alerts, out_of_range_flags)
--   DeltaCheckStatus     -> AlertReviewStatus (delta_checks)
--   ActionWorklistStatus -> ReRunStatus       (re_run_requests)
--   ActionWorklistStatus -> ScheduledTestStatus (scheduled_tests)

-- CreateEnum
CREATE TYPE "ReRunStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AlertReviewStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INITIATE_RERUN', 'IN_PROGRESS', 'RERUN_COMPLETED', 'ACCEPT_AND_RELEASE', 'RESOLVED');
CREATE TYPE "ScheduledTestStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'RESCHEDULED', 'COMPLETED');

-- re_run_requests: ActionWorklistStatus -> ReRunStatus (values map 1:1)
ALTER TABLE "re_run_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "re_run_requests" ALTER COLUMN "status" TYPE "ReRunStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    ELSE 'PENDING'
  END
)::"ReRunStatus";
ALTER TABLE "re_run_requests" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- critical_alerts: WorklistStatus -> AlertReviewStatus
ALTER TABLE "critical_alerts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "critical_alerts" ALTER COLUMN "status" TYPE "AlertReviewStatus" USING (
  CASE "status"::text
    WHEN 'NEW' THEN 'NEW'
    WHEN 'PENDING' THEN 'ACKNOWLEDGED'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'RESOLVED'
    ELSE 'NEW'
  END
)::"AlertReviewStatus";
ALTER TABLE "critical_alerts" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- out_of_range_flags: WorklistStatus -> AlertReviewStatus (same mapping as critical_alerts)
ALTER TABLE "out_of_range_flags" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "out_of_range_flags" ALTER COLUMN "status" TYPE "AlertReviewStatus" USING (
  CASE "status"::text
    WHEN 'NEW' THEN 'NEW'
    WHEN 'PENDING' THEN 'ACKNOWLEDGED'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'RESOLVED'
    ELSE 'NEW'
  END
)::"AlertReviewStatus";
ALTER TABLE "out_of_range_flags" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- delta_checks: DeltaCheckStatus -> AlertReviewStatus
ALTER TABLE "delta_checks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "delta_checks" ALTER COLUMN "status" TYPE "AlertReviewStatus" USING (
  CASE "status"::text
    WHEN 'NEW' THEN 'NEW'
    WHEN 'REVIEWED' THEN 'UNDER_REVIEW'
    WHEN 'RE_RUN' THEN 'INITIATE_RERUN'
    WHEN 'ACCEPTED' THEN 'ACCEPT_AND_RELEASE'
    WHEN 'COMPLETED' THEN 'RESOLVED'
    ELSE 'NEW'
  END
)::"AlertReviewStatus";
ALTER TABLE "delta_checks" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- scheduled_tests: ActionWorklistStatus -> ScheduledTestStatus (PENDING becomes SCHEDULED)
ALTER TABLE "scheduled_tests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "scheduled_tests" ALTER COLUMN "status" TYPE "ScheduledTestStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'SCHEDULED'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    ELSE 'SCHEDULED'
  END
)::"ScheduledTestStatus";
ALTER TABLE "scheduled_tests" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

-- DropEnum (now unused)
DROP TYPE "WorklistStatus";
DROP TYPE "ActionWorklistStatus";
DROP TYPE "DeltaCheckStatus";
