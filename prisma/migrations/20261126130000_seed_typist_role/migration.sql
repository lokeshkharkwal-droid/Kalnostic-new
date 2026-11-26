-- Seed the global (tenant-less) system role for Typists — lab users who type
-- lab-report results — so AuthRoleService.resolveByKey('typist') resolves on
-- databases that are migrated but not re-seeded. Mirrors PROFILE_REGISTRY /
-- PROFILE_LABELS / PROFILE_BRANCH_MATRIX. Idempotent.
INSERT INTO "auth_roles" (
  "id", "tenant_id", "key", "name", "description",
  "allowed_branch_types", "is_system", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), NULL, 'typist', 'Typist',
  'Types lab-report results; Laboratory and Registration modules by default.',
  ARRAY['DIAGNOSTIC','RADIOLOGY','BLOOD_BANK','COMBINED','TECHNICIAN']::"BranchType"[],
  TRUE, TRUE, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "auth_roles" WHERE "key" = 'typist' AND "tenant_id" IS NULL
);
