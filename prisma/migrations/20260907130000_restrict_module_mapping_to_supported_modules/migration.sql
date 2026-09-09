-- Restrict Department / Category / Sub-Category "module_mapping" to the seven
-- supported modules:
--   DIAGNOSTIC, OPD, IPD, RADIOLOGY, INVENTORY, PHARMACY, BLOOD_BANK
--
-- The deprecated BranchType values (FRANCHISE, COMBINED, ASSISTANT, ACCESSION,
-- TECHNICIAN, COLLECTION_CENTER) are no longer selectable via the DTOs. This
-- migration strips any of them left in existing rows while PRESERVING order and
-- every still-supported value, so existing mappings for the seven supported
-- modules are untouched. Rows already fully within the supported set are not
-- modified (the WHERE clause skips them; empty arrays are considered contained).
--
-- The `BranchType` enum itself is intentionally NOT changed — branches and the
-- staff-role PROFILE_BRANCH_MATRIX still use the full set.
--
-- RLS is FORCEd on these tenant-scoped tables, so a plain UPDATE run by the
-- migration role (no tenant GUC set) would match zero rows. Temporarily disable
-- RLS for the one-off backfill, then re-enable + FORCE it (the tenant-isolation
-- policies are left intact, so they take effect again immediately).

ALTER TABLE "departments" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sub_categories" DISABLE ROW LEVEL SECURITY;

UPDATE "departments"
SET "module_mapping" = COALESCE(
  (
    SELECT array_agg("m" ORDER BY "ord")
    FROM unnest("module_mapping") WITH ORDINALITY AS "t"("m", "ord")
    WHERE "m" = ANY (
      ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
    )
  ),
  ARRAY[]::"BranchType"[]
)
WHERE NOT (
  "module_mapping" <@ ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
);

UPDATE "categories"
SET "module_mapping" = COALESCE(
  (
    SELECT array_agg("m" ORDER BY "ord")
    FROM unnest("module_mapping") WITH ORDINALITY AS "t"("m", "ord")
    WHERE "m" = ANY (
      ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
    )
  ),
  ARRAY[]::"BranchType"[]
)
WHERE NOT (
  "module_mapping" <@ ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
);

UPDATE "sub_categories"
SET "module_mapping" = COALESCE(
  (
    SELECT array_agg("m" ORDER BY "ord")
    FROM unnest("module_mapping") WITH ORDINALITY AS "t"("m", "ord")
    WHERE "m" = ANY (
      ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
    )
  ),
  ARRAY[]::"BranchType"[]
)
WHERE NOT (
  "module_mapping" <@ ARRAY['DIAGNOSTIC','OPD','IPD','RADIOLOGY','INVENTORY','PHARMACY','BLOOD_BANK']::"BranchType"[]
);

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sub_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sub_categories" FORCE ROW LEVEL SECURITY;
