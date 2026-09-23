-- Add DAY_SHIFT to the ShiftName enum (schedule-plan shifts). Additive only — no existing rows are affected.
ALTER TYPE "ShiftName" ADD VALUE IF NOT EXISTS 'DAY_SHIFT';
