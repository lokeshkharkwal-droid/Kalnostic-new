-- Search Sample: find a sample by the barcode a Repeat took off it.
--
-- A Repeat (or a Retrieve back into Repeat) takes the barcode off the sample on purpose: the old tube is replaced
-- and Collect makes the new barcode. The old number used to live only in the audit trail. This column keeps the
-- last barcode taken off, so the search can answer "this barcode was taken off by a Repeat" (while the sample
-- waits for its new tube) and "replaced by <new barcode>" (once it is collected again), without reading audit
-- notes on every scan.
--
-- Additive and nullable: no existing row changes except the backfill below.

ALTER TABLE "order_samples" ADD COLUMN IF NOT EXISTS "barcode_before_repeat" TEXT;

-- Tiny partial index: only samples that were ever repeated carry a value. (A plain index would not help the
-- case-insensitive match the search uses; this one keeps the second lookup cheap.) Prisma cannot express a
-- partial index, so it is declared here, like the other partial indexes of this project.
CREATE INDEX IF NOT EXISTS "order_samples_barcode_before_repeat_idx"
  ON "order_samples" ("tenant_id")
  WHERE "barcode_before_repeat" IS NOT NULL AND "deleted_at" IS NULL;

-- Backfill from the audit trail: the LATEST "Barcode removed: <code> (Repeat)" line of each sample (also the
-- "(Retrieve back into Repeat)" wording). order_samples and the history table are row-level-secured and FORCED,
-- so the tenant is set for each tenant in turn - a plain UPDATE would see nothing under a role that is subject
-- to row-level security.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', t.id, true);
    UPDATE order_samples s
       SET barcode_before_repeat = x.code
      FROM (
        SELECT DISTINCT ON (h.sample_id)
               h.sample_id,
               substring(h.notes FROM '^Barcode removed: (\S+) \(') AS code
          FROM order_sample_status_history h
         WHERE h.tenant_id = t.id
           AND h.action = 'barcode-removed'
           AND h.deleted_at IS NULL
         ORDER BY h.sample_id, h.created_at DESC, h.id DESC
      ) x
     WHERE s.id = x.sample_id
       AND s.tenant_id = t.id
       AND x.code IS NOT NULL
       AND s.barcode_before_repeat IS NULL;
  END LOOP;
END $$;
