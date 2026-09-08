-- B2B Referral Panel login: link a user's branch profile to its referral panel.
-- AlterTable
ALTER TABLE "user_branch_profiles" ADD COLUMN "referral_panel_id" TEXT;

-- CreateIndex
CREATE INDEX "user_branch_profiles_referral_panel_id_idx" ON "user_branch_profiles"("referral_panel_id");

-- AddForeignKey
ALTER TABLE "user_branch_profiles" ADD CONSTRAINT "user_branch_profiles_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
