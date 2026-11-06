-- Add three faithful "combined" AbnormalFlag styles so every Master Data →
-- Abnormal Flag Logic label (and the matching Technician Reporting → Highlighted
-- option) renders exactly as its name reads, instead of being collapsed onto an
-- existing style by the frontend mapping:
--   ITALIC_AND_RED      : italic + red   (was wrongly mapped to COLOUR_HIGHLIGHT)
--   BOLD_AND_ITALIC     : bold + italic  ("Italic Bold"; was mapped to ITALIC)
--   BOLD_ITALIC_AND_RED : bold + italic + red (was mapped to BOLD_AND_RED)
-- Additive only — existing rows keep their current value. IF NOT EXISTS keeps the
-- migration idempotent if a value was already introduced manually.
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'ITALIC_AND_RED';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_AND_ITALIC';
ALTER TYPE "AbnormalFlag" ADD VALUE IF NOT EXISTS 'BOLD_ITALIC_AND_RED';
