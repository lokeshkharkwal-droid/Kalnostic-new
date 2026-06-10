-- Add the user-set `short_name` (dropdown prefix) to departments, categories,
-- and sub_categories. Mandatory (NOT NULL) going forward, but the dev tables
-- already hold rows, so we add the column nullable, backfill each existing row
-- with a generated per-tenant-unique placeholder (valid `^[A-Z0-9]{2,6}$`), then
-- enforce NOT NULL. Placeholders are tenant-wide unique, which also satisfies
-- the narrower per-department / per-category scopes; replace them via the API.
-- The partial UNIQUE indexes that enforce scoped uniqueness live in prisma/rls.sql.

-- departments: 'D0001', 'D0002', … per tenant ----------------------------------
ALTER TABLE "departments" ADD COLUMN "short_name" TEXT;
UPDATE "departments" AS d
SET "short_name" = 'D' || LPAD(seq.rn::text, 4, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM "departments"
) AS seq
WHERE d.id = seq.id;
ALTER TABLE "departments" ALTER COLUMN "short_name" SET NOT NULL;

-- categories: 'C0001', 'C0002', … per tenant -----------------------------------
ALTER TABLE "categories" ADD COLUMN "short_name" TEXT;
UPDATE "categories" AS c
SET "short_name" = 'C' || LPAD(seq.rn::text, 4, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM "categories"
) AS seq
WHERE c.id = seq.id;
ALTER TABLE "categories" ALTER COLUMN "short_name" SET NOT NULL;

-- sub_categories: 'S0001', 'S0002', … per tenant -------------------------------
ALTER TABLE "sub_categories" ADD COLUMN "short_name" TEXT;
UPDATE "sub_categories" AS s
SET "short_name" = 'S' || LPAD(seq.rn::text, 4, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM "sub_categories"
) AS seq
WHERE s.id = seq.id;
ALTER TABLE "sub_categories" ALTER COLUMN "short_name" SET NOT NULL;

-- CreateIndex
CREATE INDEX "categories_short_name_idx" ON "categories"("short_name");

-- CreateIndex
CREATE INDEX "departments_short_name_idx" ON "departments"("short_name");

-- CreateIndex
CREATE INDEX "sub_categories_short_name_idx" ON "sub_categories"("short_name");
