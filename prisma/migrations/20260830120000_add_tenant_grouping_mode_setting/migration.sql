-- Accession Group Settings toggle (Kalnostic_LIMS_Accession_Group_Settings.docx):
-- a tenant-wide grouping-mode preference, business-admin only. Defaults to
-- DEPARTMENT_SAMPLE_NAME so every existing tenant's behavior is unchanged by
-- this migration. This migration ONLY adds the setting itself (enum + column);
-- it does NOT create the accession_sample_groups table or any behavior that
-- reads/acts on this setting yet — that is a separate, later migration.

-- CreateEnum
CREATE TYPE "AccessionGroupingMode" AS ENUM ('DEPARTMENT_SAMPLE_NAME', 'DEPARTMENT', 'SAMPLE_NAME', 'ORDER');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "grouping_mode" "AccessionGroupingMode" NOT NULL DEFAULT 'DEPARTMENT_SAMPLE_NAME';
