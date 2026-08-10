-- The auto-created "General" PT category must stay unmapped (it is a fixed,
-- unmapped fallback and is no longer editable). Clear any Lab Test List / Lab
-- Panel List mappings previously assigned to a "General" category in any branch.
--
-- RLS is FORCEd on pt_categories, so a plain UPDATE run by the migration role
-- (no tenant GUC set) would match zero rows. Temporarily disable RLS for the
-- one-off cleanup, then re-enable + FORCE it (the tenant-isolation policy is left
-- intact, so it takes effect again immediately).

ALTER TABLE "pt_categories" DISABLE ROW LEVEL SECURITY;

UPDATE "pt_categories"
SET "branch_lab_test_list_id" = NULL,
    "branch_lab_panel_list_id" = NULL
WHERE "category_name" = 'General'
  AND ("branch_lab_test_list_id" IS NOT NULL OR "branch_lab_panel_list_id" IS NOT NULL);

ALTER TABLE "pt_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pt_categories" FORCE ROW LEVEL SECURITY;
