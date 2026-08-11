-- `Branch.shortName` was added to schema.prisma without a matching migration,
-- so `branches` in every deployed database is missing the column, breaking
-- every query that touches the model (e.g. GET /users/manage/me/permissions).
-- Existing branches predate this field, so backfill from `code` (last 5 chars,
-- e.g. "BR-00001" -> "00001") before enforcing NOT NULL; it's operator-editable
-- afterwards via PATCH /branches/:id.
ALTER TABLE "branches" ADD COLUMN "short_name" TEXT;

UPDATE "branches" SET "short_name" = RIGHT("code", 5) WHERE "short_name" IS NULL;

ALTER TABLE "branches" ALTER COLUMN "short_name" SET NOT NULL;
