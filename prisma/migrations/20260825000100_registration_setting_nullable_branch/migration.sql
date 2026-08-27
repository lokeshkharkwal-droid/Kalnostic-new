-- Registration Settings gains a tenant-level "business" row (branch_id NULL) in
-- addition to per-branch rows. Callers resolve the branch row first, then fall
-- back to the tenant-level row. See prisma/schema.prisma (RegistrationSetting).

-- AlterTable
ALTER TABLE "registration_settings" ALTER COLUMN "branch_id" DROP NOT NULL;
