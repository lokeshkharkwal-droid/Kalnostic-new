-- Rename referral_panels boolean columns to the `is_` convention (CLAUDE.md §3).
-- Written as RENAME COLUMN (not drop/recreate) to preserve existing data.
ALTER TABLE "referral_panels" RENAME COLUMN "commission_applicable" TO "is_commission_applicable";
ALTER TABLE "referral_panels" RENAME COLUMN "tds_applicable" TO "is_tds_applicable";
ALTER TABLE "referral_panels" RENAME COLUMN "incentive_bonus_applicable" TO "is_incentive_bonus_applicable";
