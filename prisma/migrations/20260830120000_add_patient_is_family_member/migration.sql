-- Family members are independent patients that routinely share the anchor's
-- household mobile. Flag them so they can be excluded from the per-tenant
-- active-mobile unique index (otherwise adding a family member on a shared
-- number raises a P2002 that surfaced as a 500).

-- AlterTable: flag family-member patients.
ALTER TABLE "patients"
  ADD COLUMN "is_family_member" BOOLEAN NOT NULL DEFAULT false;

-- Rebuild the per-tenant active-mobile unique index to EXCLUDE family members.
-- Primary registrations still dedupe on mobile; family members (and only they)
-- may reuse an existing active patient's number.
DROP INDEX IF EXISTS "patients_tenant_mobile_active_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "patients_tenant_mobile_active_unique"
  ON "patients" ("tenant_id", "mobile")
  WHERE "deleted_at" IS NULL AND "is_family_member" = false;
