import { Injectable, Logger } from '@nestjs/common';
import { BloodGroup, Gender, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
import { PatientHasNoLoginIdentifierException } from './exceptions/patient-auth.exceptions';
import { PATIENT_TEMP_PASSWORD } from './constants/patient-auth.constant';

/** Outcome of enabling / resetting a patient's portal login. */
export interface PatientCredentialResult {
  patientId: string;
  personId: string;
  /** The identifier the patient logs in with (mobile preferred, else email). */
  loginIdentifier: string;
  /** The temp password set now, or null when existing credentials were kept. */
  tempPassword: string | null;
  /** True when the person already had login credentials (left untouched on issue). */
  credentialsAlreadyExisted: boolean;
}

/**
 * Staff-facing management of patient-portal login credentials. Enables a patient
 * to log in by ensuring the Patient is linked to a platform `Person`, creating a
 * `PersonCredentials` row with the fixed temp password (bcrypt-hashed,
 * `isTempPassword`), and recording a `PersonTenantEnrollment` — the platform
 * index patient login reads to list the patient's businesses. Reuses the shared
 * `PasswordService`; no new credential storage (CLAUDE.md §4.2, §5).
 */
@Injectable()
export class PatientCredentialService {
  private readonly logger = new Logger(PatientCredentialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Enable or reset a patient's portal login. On `reset`, an existing password is
   * overwritten with the temp password; otherwise existing credentials are kept
   * (so a staff+patient hybrid's password is never clobbered). Runs in one
   * tenant transaction so the RLS-scoped `patients` read and the platform-table
   * writes commit together.
   * @param tenantId caller's tenant (from the JWT)
   * @param patientId the patient to enable
   * @param actorId the staff person performing this (enrolment audit trail)
   * @param options `reset: true` to force the password back to the temp password
   * @throws NotFoundException when the patient doesn't exist in the tenant
   * @throws PatientHasNoLoginIdentifierException when the patient has no mobile/email
   */
  async ensureLoginCredentials(
    tenantId: string,
    patientId: string,
    actorId: string,
    options: { reset: boolean },
  ): Promise<PatientCredentialResult> {
    const passwordHash = await this.passwordService.hash(PATIENT_TEMP_PASSWORD);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId, tenantId, deletedAt: null },
        select: {
          id: true,
          personId: true,
          branchId: true,
          salutation: true,
          firstName: true,
          middleName: true,
          lastName: true,
          gender: true,
          bloodGroup: true,
          dateOfBirth: true,
          mobile: true,
          email: true,
        },
      });
      if (!patient) {
        throw new NotFoundException('Patient', patientId);
      }

      const personId = await this.ensurePersonLink(tx, tenantId, patient);
      const person = await tx.person.findUniqueOrThrow({
        where: { id: personId },
        select: { id: true, phone: true, email: true },
      });

      const loginIdentifier = person.phone ?? person.email;
      if (!loginIdentifier) {
        throw new PatientHasNoLoginIdentifierException(patientId);
      }

      const existing = await tx.personCredentials.findUnique({
        where: { personId },
        select: { id: true },
      });

      let tempPasswordSet = false;
      if (!existing) {
        await tx.personCredentials.create({
          data: {
            personId,
            phone: person.phone,
            email: person.email,
            passwordHash,
            isTempPassword: true,
          },
        });
        tempPasswordSet = true;
      } else if (options.reset) {
        await tx.personCredentials.update({
          where: { personId },
          data: {
            passwordHash,
            isTempPassword: true,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });
        tempPasswordSet = true;
      }

      // Platform-level (RLS-exempt) enrolment index used by patient login to list
      // the patient's businesses without reading the RLS-scoped `patients` table.
      await tx.personTenantEnrollment.upsert({
        where: { personId_tenantId: { personId, tenantId } },
        create: {
          personId,
          tenantId,
          branchId: patient.branchId,
          enrolledBy: actorId,
        },
        update: {},
      });

      this.logger.log(
        `Patient login ${options.reset ? 'reset' : 'enabled'}: patient ${patientId} (person ${personId}) in tenant ${tenantId} by ${actorId}`,
      );
      return {
        patientId,
        personId,
        loginIdentifier,
        tempPassword: tempPasswordSet ? PATIENT_TEMP_PASSWORD : null,
        credentialsAlreadyExisted: !!existing,
      };
    });
  }

  /**
   * Ensure the patient is linked to a platform `Person` (the credential holder):
   * reuse the already-linked person, link an existing identity found by
   * phone/email, or create a fresh one from the patient's own fields. Marks the
   * person a patient.
   */
  private async ensurePersonLink(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patient: {
      id: string;
      personId: string | null;
      salutation: string | null;
      firstName: string;
      middleName: string | null;
      lastName: string | null;
      gender: Gender | null;
      bloodGroup: BloodGroup | null;
      dateOfBirth: Date | null;
      mobile: string | null;
      email: string | null;
    },
  ): Promise<string> {
    if (patient.personId) {
      await tx.person.update({
        where: { id: patient.personId },
        data: { isPatient: true },
      });
      return patient.personId;
    }

    const phone = patient.mobile ?? null;
    const email = patient.email ?? null;
    if (!phone && !email) {
      throw new PatientHasNoLoginIdentifierException(patient.id);
    }

    const identityOr: Prisma.PersonWhereInput[] = [];
    if (phone) identityOr.push({ phone });
    if (email) identityOr.push({ email });
    const existingPerson = await tx.person.findFirst({
      where: { deletedAt: null, OR: identityOr },
      select: { id: true },
    });

    let personId: string;
    if (existingPerson) {
      await tx.person.update({
        where: { id: existingPerson.id },
        data: { isPatient: true },
      });
      personId = existingPerson.id;
    } else {
      const created = await tx.person.create({
        data: {
          platformMrn: this.generatePlatformMrn(),
          salutation: patient.salutation,
          firstName: patient.firstName,
          middleName: patient.middleName,
          lastName: patient.lastName,
          gender: patient.gender,
          bloodGroup: patient.bloodGroup,
          dateOfBirth: patient.dateOfBirth,
          phone,
          email,
          ownerTenantId: tenantId,
          isPatient: true,
        },
        select: { id: true },
      });
      personId = created.id;
    }

    await tx.patient.update({
      where: { id: patient.id },
      data: { personId },
    });
    return personId;
  }

  /** Generate a globally-unique platform MRN: `KAL-YYYYMMDD-XXXXXXXX`. */
  private generatePlatformMrn(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return `KAL-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
