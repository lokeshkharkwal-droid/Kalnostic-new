-- Abnormal Flag Logic v1.3: the style moves from each reference range / value up to the
-- result parameter, and the style list grows to 16.
--
-- This migration ONLY adds the new enum values. It is separate from the migrations that
-- add columns and backfill data because PostgreSQL cannot use a newly added enum value in
-- the same transaction that adds it (and Prisma runs a migration file as one transaction).
--
--   RED_ONLY                     : the plain "Red" style
--   *_HIGH_LOW (7 values)        : the Quantitative-only "...and High Low" variants of
--                                  Red, Bold, Italic, Bold Italic, Bold and Red,
--                                  Italic and Red and Bold Italic and Red. The printed
--                                  value gets the word High or Low beside it.
--
-- UNDERLINE and COLOUR_HIGHLIGHT stay as real, selectable styles (they have no High Low
-- variant). Additive only: existing rows keep their current value. IF NOT EXISTS keeps the
-- migration idempotent.
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'RED_ONLY';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'RED_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'ITALIC_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_AND_ITALIC_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_AND_RED_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'ITALIC_AND_RED_HIGH_LOW';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_ITALIC_AND_RED_HIGH_LOW';
