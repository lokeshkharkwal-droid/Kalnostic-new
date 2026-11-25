/**
 * Enable Patient Login for every existing registered patient.
 *
 * The patient-portal login authenticates against the platform-level
 * `person_credentials` table (keyed to a shared `Person`) — NOT a password column
 * on `patients`. So "give every patient a password" means, per patient:
 *   1. link the patient to a platform `Person` (dedup by phone/email — the same
 *      human registered at multiple labs collapses to ONE identity);
 *   2. create a `PersonCredentials` row with the fixed temp password
 *      `Password@123` (bcrypt cost 12, `isTempPassword` → forced change on first
 *      login);
 *   3. record a `PersonTenantEnrollment` (person ↔ tenant) so login can list the
 *      patient's business(es).
 *
 * This reuses the exact, battle-tested staff "Issue Credentials" logic —
 * `PatientCredentialService.ensureLoginCredentials(..., { reset: false })` — so
 * the dedup, bcrypt hashing, enrolment and RLS all behave identically to the
 * per-patient action. Afterwards every patient can sign in with their registered
 * mobile (preferred) or email + `Password@123`.
 *
 * IDEMPOTENT (`reset: false`): a patient that already has credentials keeps their
 * current password untouched; persons/enrolments are reused. Safe to re-run.
 * Patients with no mobile AND no email are skipped (nothing to log in with) and
 * reported.
 *
 * Scope: by default ALL active patients, including family members. Family members
 * are dependents added under a primary account and are usually accessed through
 * the primary's portal, so set `INCLUDE_PATIENT_FAMILY_MEMBERS=false` to enable
 * only primary (non-family) patients.
 *
 * Run:  pnpm backfill:enable-patient-login
 *       INCLUDE_PATIENT_FAMILY_MEMBERS=false pnpm backfill:enable-patient-login
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PatientCredentialService } from '../src/modules/patient-auth/patient-credential.service';
import { PatientHasNoLoginIdentifierException } from '../src/modules/patient-auth/exceptions/patient-auth.exceptions';

const logger = new Logger('EnablePatientLogin');

/** Default: enable everyone; opt out of dependents with the env flag. */
const INCLUDE_FAMILY = process.env.INCLUDE_PATIENT_FAMILY_MEMBERS !== 'false';

/** Stored on the enrolment's `enrolledBy` (no FK; audit marker only). */
const BACKFILL_ACTOR = 'patient-login-backfill';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const credentials = app.get(PatientCredentialService);

  try {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    logger.log(
      `Enabling patient login across ${tenants.length} tenants ` +
        `(family members ${INCLUDE_FAMILY ? 'INCLUDED' : 'EXCLUDED'})…`,
    );

    let scanned = 0;
    let newlyEnabled = 0; // fresh temp password set
    let alreadyHad = 0; // credentials already existed — password kept
    let skipped = 0; // no mobile/email — cannot log in
    let errors = 0;

    for (const tenant of tenants) {
      // `patients` is RLS-scoped — read each tenant's rows under its tenant
      // context. Credential/person/enrolment writes happen inside the service's
      // own `withTenant` transaction.
      const patients = await prisma.runWithTenant(tenant.id, () =>
        prisma.patient.findMany({
          where: {
            tenantId: tenant.id,
            deletedAt: null,
            ...(INCLUDE_FAMILY ? {} : { isFamilyMember: false }),
          },
          select: { id: true },
        }),
      );

      for (const patient of patients) {
        scanned++;
        try {
          const result = await credentials.ensureLoginCredentials(
            tenant.id,
            patient.id,
            BACKFILL_ACTOR,
            { reset: false },
          );
          if (result.credentialsAlreadyExisted) alreadyHad++;
          else newlyEnabled++;
        } catch (err) {
          if (err instanceof PatientHasNoLoginIdentifierException) {
            skipped++;
          } else {
            errors++;
            logger.error(
              `Failed for patient ${patient.id} (tenant ${tenant.id}): ` +
                (err instanceof Error ? err.message : String(err)),
            );
          }
        }
      }
    }

    logger.log(
      `Done. Scanned ${scanned} patients — ${newlyEnabled} newly enabled, ` +
        `${alreadyHad} already had credentials, ${skipped} skipped (no ` +
        `mobile/email), ${errors} errors. Temp password: Password@123 ` +
        `(forced change on first login).`,
    );
    if (errors > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
