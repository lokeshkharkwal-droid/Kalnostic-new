-- AlterTable
ALTER TABLE "external_referrals" ADD COLUMN     "tds" INTEGER;

-- AlterTable
ALTER TABLE "internal_referrals" ADD COLUMN     "tds" INTEGER;

-- AlterTable
ALTER TABLE "referral_doctors" ADD COLUMN     "tds" INTEGER;

-- AlterTable
ALTER TABLE "referral_panels" ADD COLUMN     "tds" INTEGER;
