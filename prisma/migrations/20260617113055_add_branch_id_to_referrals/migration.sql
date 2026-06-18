-- AlterTable
ALTER TABLE "external_referrals" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "internal_referrals" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "referral_doctors" ADD COLUMN     "branch_id" TEXT;

-- AlterTable
ALTER TABLE "referral_panels" ADD COLUMN     "branch_id" TEXT;

-- CreateIndex
CREATE INDEX "external_referrals_branch_id_idx" ON "external_referrals"("branch_id");

-- CreateIndex
CREATE INDEX "internal_referrals_branch_id_idx" ON "internal_referrals"("branch_id");

-- CreateIndex
CREATE INDEX "referral_doctors_branch_id_idx" ON "referral_doctors"("branch_id");

-- CreateIndex
CREATE INDEX "referral_panels_branch_id_idx" ON "referral_panels"("branch_id");
