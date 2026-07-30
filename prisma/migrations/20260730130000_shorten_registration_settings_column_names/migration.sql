-- 4 columns on "registration_settings" were originally truncated to exactly
-- 63 characters — PostgreSQL's NAMEDATALEN limit — because the full,
-- semantically-intended name (matching the @map() value that used to be in
-- schema.prisma) is 64-66 bytes and cannot exist as a Postgres identifier at
-- all (CREATE TABLE / RENAME COLUMN with such a name is rejected outright,
-- confirmed live). The truncation left the name mid-word and non-obvious.
--
-- Fix: rename to a shorter, deliberately-chosen, still-readable name (all
-- comfortably under 63 bytes) instead of a length-cut mid-word fragment.
-- RENAME COLUMN preserves existing row data — no drop/recreate.
--
-- The Prisma model field names themselves (e.g.
-- ChargesAndDeductions_AllowOrderWithoutClearingPreviousDues) are unchanged —
-- only the underlying @map() column name changes, so no application code
-- referencing these fields needs to change.

ALTER TABLE "registration_settings" RENAME COLUMN "charges_and_deductions_allow_order_without_clearing_previous_du" TO "charges_and_deductions_allow_order_without_clearing_dues";

ALTER TABLE "registration_settings" RENAME COLUMN "charges_and_deductions_allow_partial_billing_of_discounted_orde" TO "charges_and_deductions_allow_partial_billing_of_discounted";

ALTER TABLE "registration_settings" RENAME COLUMN "referral_and_staff_permissions_allow_add_radiology_technician_n" TO "referral_and_staff_permissions_allow_add_radiology_tech_name";

ALTER TABLE "registration_settings" RENAME COLUMN "appointment_allow_progress_of_unpaid_and_partial_paid_appointme" TO "appointment_allow_progress_unpaid_and_partial_paid_appts";
