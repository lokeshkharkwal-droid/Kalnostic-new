-- Standardize payment modes onto the single `PaymentMode` enum.
--
-- The app carried four parallel payment-mode enums; the referral/doctor/settlement
-- payout columns are consolidated onto `PaymentMode` (CASH, CREDIT, UPI, CARD,
-- WALLET, BANK_TRANSFER) so every payment/payout mode is one standardized set of 6.
--
-- `PaymentMode` has no CHEQUE member, so any existing CHEQUE payout is remapped to
-- BANK_TRANSFER (a cheque is a bank instrument). This remap is lossy — a former
-- cheque can no longer be told apart from a true bank transfer.
--
-- Postgres cannot retype a column to an enum missing a value its rows still use,
-- and cannot retype a column that still carries an old-typed DEFAULT — hence the
-- ordering below: remap CHEQUE first, drop defaults, retype (text round-trip cast
-- between distinct enum types), re-add defaults, then drop the now-unused enums.
-- All affected tables are RLS-scoped on `tenant_id`; no policy references these
-- columns, so no policy change is needed.

-- 1. Retire CHEQUE across every affected table BEFORE any type change.
UPDATE "referral_panels"     SET "payment_mode" = 'BANK_TRANSFER' WHERE "payment_mode" = 'CHEQUE';
UPDATE "doctors"             SET "payment_mode" = 'BANK_TRANSFER' WHERE "payment_mode" = 'CHEQUE';
UPDATE "referral_doctors"    SET "payment_mode" = 'BANK_TRANSFER' WHERE "payment_mode" = 'CHEQUE';
UPDATE "external_referrals"  SET "payment_mode" = 'BANK_TRANSFER' WHERE "payment_mode" = 'CHEQUE';
UPDATE "internal_referrals"  SET "payment_mode" = 'BANK_TRANSFER' WHERE "payment_mode" = 'CHEQUE';
UPDATE "settlement_payments" SET "payout_mode"  = 'BANK_TRANSFER' WHERE "payout_mode"  = 'CHEQUE';

-- 2. Drop old-typed DEFAULTs (the five referral/doctor columns; payout_mode has none).
ALTER TABLE "referral_panels"    ALTER COLUMN "payment_mode" DROP DEFAULT;
ALTER TABLE "doctors"            ALTER COLUMN "payment_mode" DROP DEFAULT;
ALTER TABLE "referral_doctors"   ALTER COLUMN "payment_mode" DROP DEFAULT;
ALTER TABLE "external_referrals" ALTER COLUMN "payment_mode" DROP DEFAULT;
ALTER TABLE "internal_referrals" ALTER COLUMN "payment_mode" DROP DEFAULT;

-- 3. Retype each column to "PaymentMode" (text round-trip: PG won't implicitly cast
--    between two distinct enum types).
ALTER TABLE "referral_panels"    ALTER COLUMN "payment_mode" TYPE "PaymentMode" USING ("payment_mode"::text::"PaymentMode");
ALTER TABLE "doctors"            ALTER COLUMN "payment_mode" TYPE "PaymentMode" USING ("payment_mode"::text::"PaymentMode");
ALTER TABLE "referral_doctors"   ALTER COLUMN "payment_mode" TYPE "PaymentMode" USING ("payment_mode"::text::"PaymentMode");
ALTER TABLE "external_referrals" ALTER COLUMN "payment_mode" TYPE "PaymentMode" USING ("payment_mode"::text::"PaymentMode");
ALTER TABLE "internal_referrals" ALTER COLUMN "payment_mode" TYPE "PaymentMode" USING ("payment_mode"::text::"PaymentMode");
ALTER TABLE "settlement_payments" ALTER COLUMN "payout_mode" TYPE "PaymentMode" USING ("payout_mode"::text::"PaymentMode");

-- 4. Re-add DEFAULT 'BANK_TRANSFER' (now of type "PaymentMode") on the five.
ALTER TABLE "referral_panels"    ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';
ALTER TABLE "doctors"            ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';
ALTER TABLE "referral_doctors"   ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';
ALTER TABLE "external_referrals" ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';
ALTER TABLE "internal_referrals" ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';

-- 5. Drop the now-unused enum types.
DROP TYPE "SettlementPayoutMode";
DROP TYPE "DoctorPaymentMode";
DROP TYPE "ReferralPaymentMode";
