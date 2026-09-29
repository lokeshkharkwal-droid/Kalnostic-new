-- Adds the AdapterStatus tri-state (ONLINE/REPORT_ONLY/INACTIVE) and
-- replaces LabAdapter.is_active with LabAdapter.status. Existing data is
-- backfilled: is_active=true -> ONLINE, is_active=false -> INACTIVE. No
-- existing row can become REPORT_ONLY automatically — that's a genuinely
-- new, user-chosen state going forward.

CREATE TYPE "AdapterStatus" AS ENUM ('ONLINE', 'REPORT_ONLY', 'INACTIVE');

ALTER TABLE "lab_adapters" ADD COLUMN "status" "AdapterStatus" NOT NULL DEFAULT 'ONLINE';

UPDATE "lab_adapters" SET "status" = CASE WHEN "is_active" THEN 'ONLINE'::"AdapterStatus" ELSE 'INACTIVE'::"AdapterStatus" END;

ALTER TABLE "lab_adapters" DROP COLUMN "is_active";
