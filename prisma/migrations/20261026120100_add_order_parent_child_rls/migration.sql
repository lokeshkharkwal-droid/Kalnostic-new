-- RLS / constraint companion for the parent/child sub-order model.
-- `orders` already has tenant isolation (see orders_tenant_isolation); this
-- migration only adds the partial-unique guard so a combined order's parent has
-- at most one ACTIVE child per section (one DIAGNOSTICS + one RADIOLOGY).
-- Idempotent — mirrors the block in prisma/rls.sql.

CREATE UNIQUE INDEX IF NOT EXISTS orders_parent_section_active_unique
  ON orders (parent_order_id, section)
  WHERE deleted_at IS NULL AND parent_order_id IS NOT NULL;
