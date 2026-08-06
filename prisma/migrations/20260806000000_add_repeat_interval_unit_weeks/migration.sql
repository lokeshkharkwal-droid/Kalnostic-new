-- Add WEEKS to the RepeatIntervalUnit enum (used by quotation validity + lab-test
-- repeat-interval restrictions). Additive only — no existing rows are affected.
ALTER TYPE "RepeatIntervalUnit" ADD VALUE IF NOT EXISTS 'WEEKS';
