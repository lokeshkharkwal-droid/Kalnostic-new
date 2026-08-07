-- Mobile Number is no longer mandatory for Referral Doctors (product decision:
-- mobile should not be required in any of the 4 Referrals forms — Referral
-- Panel, Referral Doctors, External Referrals, Internal Referrals already
-- treat it as optional; Referral Doctor was the one holdout).
ALTER TABLE "referral_doctors" ALTER COLUMN "mobile_number" DROP NOT NULL;
