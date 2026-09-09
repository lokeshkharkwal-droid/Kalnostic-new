-- Seed the global (tenant-less) system role for B2B referral-panel logins, so
-- AuthRoleService.resolveByKey('b2b_referring_panel') resolves. Idempotent.
INSERT INTO "auth_roles" (
  "id", "tenant_id", "key", "name", "description",
  "allowed_branch_types", "is_system", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), NULL, 'b2b_referring_panel', 'B2B Referring Panel',
  'Dedicated login for a referral panel; sees only its own panel data.',
  ARRAY['DIAGNOSTIC','RADIOLOGY','OPD','IPD','PHARMACY','INVENTORY','BLOOD_BANK','FRANCHISE','COMBINED','COLLECTION_CENTER']::"BranchType"[],
  TRUE, TRUE, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "auth_roles" WHERE "key" = 'b2b_referring_panel' AND "tenant_id" IS NULL
);
