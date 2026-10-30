-- ============================================================================
-- DATA-DELETION MIGRATION — purge all orders + Oct-2026 non-imported patients
-- ============================================================================
--
-- ⚠️  THIS MIGRATION PERMANENTLY DELETES DATA (hard delete). It is irreversible.
--     TAKE A FULL DATABASE BACKUP BEFORE RUNNING `prisma migrate deploy`.
--
-- Scope (confirmed with the requester):
--   1. ORDERS — EVERY order in the database, all tenants/branches, every status
--      (DRAFT / QUOTE / APPOINTMENT / ORDER …). This covers "quotes" and "drafts"
--      because those are just Orders with status QUOTE / DRAFT.
--   2. ORDER-RELATED RECORDS — every table that FK-depends on an order, deleted
--      leaf-first: order sections, items, lab reports (+ all 13 reporting
--      child tables), accession samples (+ transfers/history), order notes,
--      home-visit collections, appointments, payment ledger (payment_details),
--      and the WHOLE invoice + settlement trees (invoices, invoice_source_orders,
--      invoice_payments, settlements, settlement_source_payments,
--      settlement_payments). Because every order is deleted, every invoice /
--      settlement references only deleted orders, so they are removed in full.
--   3. PATIENTS — ALL patients CREATED IN OCTOBER 2026 EXCEPT those imported via a
--      data migration (family members ARE included):
--        legacy_patient_id IS NULL        -- natively created (NOT migrated from
--                                         --   EzHealthTrack; imported rows carry
--                                         --   a non-null legacy_patient_id and are
--                                         --   PRESERVED)
--        AND created_at >= '2026-10-01'   -- UTC; created_at is timestamp(3) stored
--        AND created_at <  '2026-11-01'   --   in UTC (Prisma default, no @db.Timestamptz)
--      plus their patient-owned children (medical_histories, patient_documents)
--      and any family links referencing them (as anchor or member). Their orders
--      are already gone from step 1/2.
--
-- EXPLICITLY NOT TOUCHED (preserve):
--   * Lab tests & lab panels, master data, catalogue, branches, tenants, users,
--     referral panels/doctors, settings — none are deleted.
--   * Imported patients (legacy_patient_id IS NOT NULL) and patients created
--     outside October 2026. (Family members created in October ARE deleted;
--     their links to any kept patient are unlinked in 3c.)
--   * Non-FK LOGICAL references to orders are left intact on purpose (they have no
--     FK constraint and are audit/trace data): adapter_results.order_id,
--     audit logs, communication logs, notifications. They may hold a now-dangling
--     order id; that is acceptable for audit tables and is NOT an FK violation.
--
-- Safety mechanics:
--   * RLS: every target table has FORCE ROW LEVEL SECURITY, so a DELETE run by the
--     migration role (no app.current_tenant_id GUC set) would match ZERO rows.
--     We therefore DISABLE RLS on each target table, run the deletes, then
--     re-ENABLE + re-FORCE RLS (same project pattern as
--     20260807000000_clear_general_pt_category_mappings). The tenant-isolation
--     POLICIES themselves are left intact, so they take effect again immediately.
--   * Deletion order is strictly leaf-first so no FK constraint is ever violated.
--     The only non-cascade (Restrict) FKs into the order tree are handled by
--     ordering: invoice_source_orders & settlement_source_payments are deleted
--     before `orders`; settlement_source_payments is deleted before
--     `payment_details`; the orders.source_quotation_id self-reference is NULLed
--     before deleting `orders`.
--   * Prisma runs this migration file inside a single transaction (PostgreSQL has
--     transactional DDL), so a failure anywhere rolls the WHOLE migration back —
--     including the RLS toggles. Do NOT add explicit BEGIN/COMMIT.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Temporarily DISABLE Row-Level Security on every target table.
-- ----------------------------------------------------------------------------
-- Order-subtree tables
ALTER TABLE "lab_report_result_values"      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_overall_results"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_parameter_notes"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_notes"              DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_attachments"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_history"            DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tat_adjustments"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "re_run_requests"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "critical_alerts"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "out_of_range_flags"            DISABLE ROW LEVEL SECURITY;
ALTER TABLE "delta_checks"                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_tests"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "multi_step_test_processes"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_inventory_usage"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_reports"                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_sample_tests"            DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_sample_status_history"   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sample_transfers"              DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_samples"                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE "home_visit_status_history"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "home_visit_collections"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_payments"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_source_payments"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments"              DISABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_source_orders"         DISABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements"                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices"                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_details"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_notes"                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_diagnostics"             DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_opd"                     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_radiology"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items"                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"                        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_status_history"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments"                  DISABLE ROW LEVEL SECURITY;
-- Patient tables
ALTER TABLE "medical_histories"             DISABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_documents"             DISABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_family_links"          DISABLE ROW LEVEL SECURITY;
ALTER TABLE "patients"                      DISABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- STEP 2 — Delete the ORDER tree (every order, all tenants), leaf-first.
-- ----------------------------------------------------------------------------

-- 2a. Lab-report reporting cluster (children of lab_reports) ------------------
DELETE FROM "lab_report_result_values";
DELETE FROM "lab_report_overall_results";
DELETE FROM "lab_report_parameter_notes";
DELETE FROM "lab_report_notes";
DELETE FROM "lab_report_attachments";
DELETE FROM "lab_report_history";
DELETE FROM "tat_adjustments";
DELETE FROM "re_run_requests";
DELETE FROM "critical_alerts";
DELETE FROM "out_of_range_flags";
DELETE FROM "delta_checks";
DELETE FROM "scheduled_tests";
DELETE FROM "multi_step_test_processes";
DELETE FROM "lab_report_inventory_usage";
-- lab_reports (child of order_items)
DELETE FROM "lab_reports";

-- 2b. Accession sample cluster (children of order_samples / order_items) ------
DELETE FROM "order_sample_tests";
DELETE FROM "order_sample_status_history";
DELETE FROM "sample_transfers";
DELETE FROM "order_samples";

-- 2c. Home-visit collection cluster (children of orders) ----------------------
DELETE FROM "home_visit_status_history";
DELETE FROM "home_visit_collections";

-- 2d. Settlement tree --------------------------------------------------------
-- settlement_source_payments references BOTH orders AND payment_details with
-- Restrict FKs, so it must be deleted before `orders` and `payment_details`.
DELETE FROM "settlement_payments";
DELETE FROM "settlement_source_payments";
DELETE FROM "settlements";

-- 2e. Invoice tree -----------------------------------------------------------
-- invoice_source_orders references orders with a Restrict FK — delete before `orders`.
DELETE FROM "invoice_payments";
DELETE FROM "invoice_source_orders";
DELETE FROM "invoices";

-- 2f. Order financial ledger + direct children -------------------------------
DELETE FROM "payment_details";
DELETE FROM "order_notes";
DELETE FROM "order_diagnostics";
DELETE FROM "order_opd";
DELETE FROM "order_radiology";
DELETE FROM "order_items";

-- 2g. Break the orders → orders self-reference (source_quotation_id is a
--     Restrict FK; NULL it so deleting all orders cannot trip the constraint).
UPDATE "orders" SET "source_quotation_id" = NULL WHERE "source_quotation_id" IS NOT NULL;

-- 2h. The orders themselves --------------------------------------------------
DELETE FROM "orders";

-- 2i. Appointments (parents of orders via orders.appointment_id — safe to
--     delete now that all orders are gone; every appointment is order-derived).
DELETE FROM "appointment_status_history";
DELETE FROM "appointments";


-- ----------------------------------------------------------------------------
-- STEP 3 — Delete ALL patients created in October 2026 EXCEPT migration-imported
--          ones (legacy_patient_id IS NOT NULL), family members included, plus
--          their owned children. Orders were already removed above.
-- ----------------------------------------------------------------------------
-- The subqueries resolve the target set BEFORE the patients rows are deleted
-- (patient deletion is the last statement in this block).

-- 3a. Medical histories of target patients
DELETE FROM "medical_histories"
WHERE "patient_id" IN (
  SELECT "id" FROM "patients"
  WHERE "legacy_patient_id" IS NULL
    AND "created_at" >= '2026-10-01 00:00:00'
    AND "created_at" <  '2026-11-01 00:00:00'
);

-- 3b. Documents / consents of target patients
DELETE FROM "patient_documents"
WHERE "patient_id" IN (
  SELECT "id" FROM "patients"
  WHERE "legacy_patient_id" IS NULL
    AND "created_at" >= '2026-10-01 00:00:00'
    AND "created_at" <  '2026-11-01 00:00:00'
);

-- 3c. Family links that reference a target patient on EITHER side (anchor or
--     member). This unlinks — it never deletes the counterpart patient row.
DELETE FROM "patient_family_links"
WHERE "patient_id" IN (
  SELECT "id" FROM "patients"
  WHERE "legacy_patient_id" IS NULL
    AND "created_at" >= '2026-10-01 00:00:00'
    AND "created_at" <  '2026-11-01 00:00:00'
)
   OR "member_id" IN (
  SELECT "id" FROM "patients"
  WHERE "legacy_patient_id" IS NULL
    AND "created_at" >= '2026-10-01 00:00:00'
    AND "created_at" <  '2026-11-01 00:00:00'
);

-- 3d. The target patients themselves
DELETE FROM "patients"
WHERE "legacy_patient_id" IS NULL
  AND "created_at" >= '2026-10-01 00:00:00'
  AND "created_at" <  '2026-11-01 00:00:00';


-- ----------------------------------------------------------------------------
-- STEP 4 — Re-ENABLE + re-FORCE Row-Level Security on every target table.
--          (Tenant-isolation policies were never dropped, so they resume at once.)
-- ----------------------------------------------------------------------------
-- Order-subtree tables
ALTER TABLE "lab_report_result_values"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_result_values"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_overall_results"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_overall_results"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_parameter_notes"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_parameter_notes"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_notes"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_notes"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_attachments"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_attachments"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_history"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_history"            FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tat_adjustments"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tat_adjustments"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "re_run_requests"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "re_run_requests"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "critical_alerts"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "critical_alerts"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "out_of_range_flags"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "out_of_range_flags"            FORCE  ROW LEVEL SECURITY;
ALTER TABLE "delta_checks"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delta_checks"                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "scheduled_tests"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_tests"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "multi_step_test_processes"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "multi_step_test_processes"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_report_inventory_usage"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_report_inventory_usage"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "lab_reports"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_reports"                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_sample_tests"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_sample_tests"            FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_sample_status_history"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_sample_status_history"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "sample_transfers"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sample_transfers"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_samples"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_samples"                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE "home_visit_status_history"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_visit_status_history"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "home_visit_collections"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_visit_collections"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "settlement_payments"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_payments"           FORCE  ROW LEVEL SECURITY;
ALTER TABLE "settlement_source_payments"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_source_payments"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments"              FORCE  ROW LEVEL SECURITY;
ALTER TABLE "invoice_source_orders"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_source_orders"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "settlements"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements"                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "invoices"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices"                      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "payment_details"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_details"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_notes"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_notes"                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_diagnostics"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_diagnostics"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_opd"                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_opd"                     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_radiology"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_radiology"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "order_items"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items"                   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "orders"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"                        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "appointment_status_history"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_status_history"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "appointments"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments"                  FORCE  ROW LEVEL SECURITY;
-- Patient tables
ALTER TABLE "medical_histories"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_histories"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "patient_documents"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_documents"             FORCE  ROW LEVEL SECURITY;
ALTER TABLE "patient_family_links"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_family_links"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "patients"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients"                      FORCE  ROW LEVEL SECURITY;
