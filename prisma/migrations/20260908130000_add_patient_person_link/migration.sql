-- Shared cross-tenant patient identity. Each per-tenant `Patient` projection may
-- link to the platform-level `Person` (globally-unique phone) so two businesses
-- that register the same human point at ONE identity — the basis for reusing an
-- existing patient during order creation without duplicating it. Nullable:
-- family members (who may share a phone) and legacy rows stay unlinked until
-- backfilled (scripts/backfill-patient-persons.ts). `persons` is a platform-level
-- table (no RLS), so the cross-tenant phone lookup needs no isolation bypass.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "person_id" TEXT;

-- CreateIndex
CREATE INDEX "patients_person_id_idx" ON "patients"("person_id");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
