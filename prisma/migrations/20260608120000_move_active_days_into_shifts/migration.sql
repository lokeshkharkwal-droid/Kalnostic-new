-- Move `active_days` from the schedule (plan) level into each shift.
-- Backfill first so existing rows stay valid against the new per-shift shape:
-- fold the plan-level `active_days` array onto every element of `shifts`.
UPDATE "schedules" s
SET "shifts" = (
  SELECT jsonb_agg(elem || jsonb_build_object('activeDays', s."active_days"))
  FROM jsonb_array_elements(s."shifts") AS elem
)
WHERE jsonb_typeof(s."shifts") = 'array';

-- AlterTable
ALTER TABLE "schedules" DROP COLUMN "active_days";
