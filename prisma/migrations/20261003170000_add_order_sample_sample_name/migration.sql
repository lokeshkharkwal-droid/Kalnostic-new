-- Add sample_name to order_samples
ALTER TABLE "order_samples" ADD COLUMN IF NOT EXISTS "sample_name" TEXT;
