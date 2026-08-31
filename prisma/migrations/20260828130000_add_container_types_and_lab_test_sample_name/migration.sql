-- Expand ContainerType with the real tube colours/receptacles that previously
-- had no distinct value (SST, Citrate, Heparin, Stool, Swab, Other). Citrate and
-- Stool used to both collapse onto STERILE_CONTAINER on the frontend, corrupting
-- the round-trip; they now have their own values. STERILE_CONTAINER is kept so
-- legacy rows stay valid. Additive only — no existing rows are affected.
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'SST_TUBE_YELLOW_TOP';
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'CITRATE_TUBE_BLUE_TOP';
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'HEPARIN_TUBE_GREEN_TOP';
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'STOOL_CONTAINER';
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'SWAB';
ALTER TYPE "ContainerType" ADD VALUE IF NOT EXISTS 'OTHER';

-- Persist the human-readable sample name chosen when configuring a test's sample
-- (e.g. "Blood (EDTA)"). One sample_type can back several sample names, so it
-- can't be derived on read-back and needs its own column.
ALTER TABLE "lab_test_samples"
  ADD COLUMN "sample_name" TEXT;
