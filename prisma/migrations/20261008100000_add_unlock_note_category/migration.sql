-- AlterEnum
-- Records every Unlock Test (who/when) next to the existing LOCK note row.
ALTER TYPE "LabReportNoteCategory" ADD VALUE IF NOT EXISTS 'UNLOCK';
