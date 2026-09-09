-- Add CALCULATED to the ResultValueSource enum. A dynamic/calculated parameter's
-- auto-computed value is stored with source = 'CALCULATED', distinguishing it from
-- a manual technician override ('MANUAL') and an analyzer/adapter value ('ADAPTER').
-- This lets result entry recompute CALCULATED values on load while preserving a
-- technician's manual override. Additive only — no existing rows are affected.
ALTER TYPE "ResultValueSource" ADD VALUE IF NOT EXISTS 'CALCULATED';
