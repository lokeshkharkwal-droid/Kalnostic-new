-- Extend referral → pricing-list mapping to radiology.
-- A ReferralListAssignment already carries the branch Lab Test / Lab Panel List
-- a referral maps to; these two columns add the parallel branch Radiology Test /
-- Radiology Panel List so radiology items get referral-based pricing too.
-- Nullable (null = fall back to the branch's default Walk-in radiology lists).
-- Covered by the existing `referral_list_assignments` tenant RLS policy.
ALTER TABLE "referral_list_assignments" ADD COLUMN "branch_radiology_test_list_id" TEXT;
ALTER TABLE "referral_list_assignments" ADD COLUMN "branch_radiology_panel_list_id" TEXT;
