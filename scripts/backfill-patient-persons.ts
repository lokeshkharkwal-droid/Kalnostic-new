/**
 * Backfill shared `Person` identities for existing patients.
 *
 * The cross-tenant patient feature keys patient identity on the platform-level
 * `Person` (globally-unique phone). Patients created before this feature have no
 * `person_id`, so the cross-tenant phone lookup can't find them. This one-off
 * script:
 *   1. reads every ACTIVE, non-family patient that has a valid mobile and no
 *      `person_id` (per tenant, via RLS-scoped `runWithTenant`);
 *   2. groups them GLOBALLY by normalized phone — the dedup that unifies the same
 *      human registered at multiple businesses into ONE identity;
 *   3. for each phone: reuses an existing `Person` with that phone, or creates one
 *      from the earliest patient (its tenant becomes `ownerTenantId`);
 *   4. links every patient in the group to that `Person`.
 *
 * IDEMPOTENT: patients that already have a `person_id` are skipped, and persons
 * are matched by phone before creating — re-running only fills gaps. `persons`
 * and `tenants` are platform-level (no RLS); patient reads/writes go through
 * `runWithTenant` so RLS is satisfied per tenant.
 *
 * Run:  pnpm backfill:patient-persons
 */
import { randomBytes } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { isValidPhone, normalizePhone } from '../src/common/utils/phone.util';

const logger = new Logger('PatientPersonBackfill');

/** The patient identity fields we need to seed a fresh `Person`. */
interface PatientRow {
  id: string;
  tenantId: string;
  salutation: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  gender: string | null;
  bloodGroup: string | null;
  dateOfBirth: Date | null;
  mobile: string;
  email: string | null;
  aadhaarNumber: string | null;
  panNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactMobileNumber: string | null;
  createdAt: Date;
}

/** Generate a globally-unique platform MRN: `KAL-YYYYMMDD-XXXXXXXX`. */
function generatePlatformMrn(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `KAL-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);

  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    logger.log(
      `Scanning ${tenants.length} tenants for un-backfilled patients…`,
    );

    // Stage 1 — collect candidate patients across all tenants (RLS-scoped read).
    const byPhone = new Map<string, PatientRow[]>();
    let candidates = 0;
    for (const { id: tenantId } of tenants) {
      const rows = (await prisma.runWithTenant(tenantId, () =>
        prisma.patient.findMany({
          where: {
            tenantId,
            deletedAt: null,
            isFamilyMember: false,
            personId: null,
          },
          select: {
            id: true,
            tenantId: true,
            salutation: true,
            firstName: true,
            middleName: true,
            lastName: true,
            gender: true,
            bloodGroup: true,
            dateOfBirth: true,
            mobile: true,
            email: true,
            aadhaarNumber: true,
            panNumber: true,
            emergencyContactName: true,
            emergencyContactMobileNumber: true,
            createdAt: true,
          },
        }),
      )) as PatientRow[];
      for (const row of rows) {
        const phone = normalizePhone(row.mobile);
        if (!isValidPhone(phone)) {
          continue; // no usable global identity key — leave unlinked
        }
        const group = byPhone.get(phone) ?? [];
        group.push(row);
        byPhone.set(phone, group);
        candidates++;
      }
    }
    logger.log(
      `Found ${candidates} patients across ${byPhone.size} distinct phone numbers.`,
    );

    // Stage 2 — per phone: resolve/create the shared Person, then link the group.
    let personsCreated = 0;
    let personsReused = 0;
    let linked = 0;
    for (const [phone, group] of byPhone) {
      group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const earliest = group[0]!;

      let person = await prisma.person.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (person) {
        personsReused++;
      } else {
        person = await prisma.person.create({
          data: {
            platformMrn: generatePlatformMrn(),
            salutation: earliest.salutation,
            firstName: earliest.firstName,
            middleName: earliest.middleName,
            lastName: earliest.lastName,
            gender: earliest.gender as never,
            bloodGroup: earliest.bloodGroup as never,
            dateOfBirth: earliest.dateOfBirth,
            phone,
            email: earliest.email,
            aadhaarNumber: earliest.aadhaarNumber,
            panNumber: earliest.panNumber,
            emergencyContactName: earliest.emergencyContactName,
            emergencyContactNumber: earliest.emergencyContactMobileNumber,
            ownerTenantId: earliest.tenantId,
            isPatient: true,
          },
          select: { id: true },
        });
        personsCreated++;
      }

      const personId = person.id;
      for (const row of group) {
        await prisma.runWithTenant(row.tenantId, () =>
          prisma.patient.update({
            where: { id: row.id },
            data: { personId },
          }),
        );
        linked++;
      }
    }

    logger.log(
      `Done. Linked ${linked} patients — ${personsCreated} persons created, ${personsReused} reused.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
