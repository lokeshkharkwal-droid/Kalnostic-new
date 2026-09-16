-- Add a "default receiving branch" flag to Collection Center → receiving-branch
-- mappings. Exactly one active mapping per collection center may be the default;
-- the partial unique index below enforces "at most one default" at the database
-- level (mirrors the pattern used for the (center, receiver) active-unique index
-- in prisma/rls.sql, which Prisma cannot express).

ALTER TABLE "collection_center_mappings"
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- At most ONE active default receiving branch per collection center.
CREATE UNIQUE INDEX IF NOT EXISTS "ccm_center_default_active_unique"
  ON "collection_center_mappings" ("collection_center_id")
  WHERE "deleted_at" IS NULL AND "is_default" = true;
