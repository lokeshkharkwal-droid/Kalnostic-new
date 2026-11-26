import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { InvalidPasswordException } from '../auth/exceptions/auth.exceptions';
import { PatientLoginDto } from './dto/patient-login.dto';
import { SelectBusinessDto } from './dto/select-business.dto';
import { SwitchBusinessDto } from './dto/switch-business.dto';
import { ChangePatientPasswordDto } from './dto/change-patient-password.dto';
import {
  PatientAccountInactiveException,
  PatientAccountLockedException,
  PatientInvalidBootstrapTokenException,
  PatientInvalidCredentialsException,
  PatientInvalidRefreshTokenException,
  PatientNoLoginAccessException,
  PatientTenantNotSelectableException,
} from './exceptions/patient-auth.exceptions';
import {
  LOCK_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  PATIENT_ACCESS_TOKEN_TYPE,
  PATIENT_BOOTSTRAP_TOKEN_TYPE,
  PATIENT_TOKEN_TYPE,
} from './constants/patient-auth.constant';
import type {
  PatientBootstrapPayload,
  PatientJwtPayload,
} from './types/patient-jwt-payload.type';

/** One selectable business in the login response. */
export interface SelectableBusiness {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  shortName: string | null;
  logoUrl: string | null;
}

/** The patient summary returned alongside a freshly issued session. */
export interface PatientSessionSummary {
  patientId: string;
  personId: string;
  tenantId: string;
  branchId: string | null;
  platformMrn: string | null;
  name: string;
}

/**
 * Patient-portal authentication. A third, isolated auth system that reuses the
 * platform-level `person_credentials` / `persons` / `refresh_tokens` tables and
 * the shared `PasswordService` + lockout policy (CLAUDE.md §5). Flow is two-step
 * ("login then pick business"): `login` authenticates the platform identity and
 * lists the businesses the patient belongs to; `selectBusiness` exchanges a
 * bootstrap token + chosen tenant for a tenant-scoped access + refresh pair.
 */
@Injectable()
export class PatientAuthService {
  private readonly logger = new Logger(PatientAuthService.name);
  private readonly accessTtl: JwtSignOptions['expiresIn'];
  private readonly bootstrapTtl: JwtSignOptions['expiresIn'];
  private readonly refreshDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTtl = this.config.get<string>(
      'PATIENT_ACCESS_TTL',
      '15m',
    ) as JwtSignOptions['expiresIn'];
    this.bootstrapTtl = this.config.get<string>(
      'PATIENT_BOOTSTRAP_TTL',
      '10m',
    ) as JwtSignOptions['expiresIn'];
    this.refreshDays = this.config.get<number>('PATIENT_REFRESH_TTL_DAYS', 30);
  }

  /**
   * Step 1 — authenticate the platform identity (mobile/email + password) and
   * return a short-lived bootstrap token plus the businesses the patient may
   * enter. No tenant is resolved yet. Enforces the shared lockout policy.
   * @param dto identifier + password
   * @param clientIp client IP (audit)
   * @returns `{ bootstrapToken, mustChangePassword, businesses }`
   * @throws PatientInvalidCredentialsException on unknown identifier / bad password
   * @throws PatientAccountLockedException when locked
   * @throws PatientAccountInactiveException when the person is inactive
   * @throws PatientNoLoginAccessException when the identity has no patient enrolment
   */
  async login(
    dto: PatientLoginDto,
    clientIp: string,
  ): Promise<{
    bootstrapToken: string;
    mustChangePassword: boolean;
    businesses: SelectableBusiness[];
  }> {
    const credentials = await this.prisma.personCredentials.findFirst({
      where: {
        OR: [{ phone: dto.identifier }, { email: dto.identifier }],
        deletedAt: null,
      },
    });
    if (!credentials) {
      throw new PatientInvalidCredentialsException();
    }
    if (credentials.lockedUntil && credentials.lockedUntil > new Date()) {
      throw new PatientAccountLockedException(credentials.lockedUntil);
    }

    const person = await this.prisma.person.findFirst({
      where: { id: credentials.personId, deletedAt: null },
      select: { id: true, isActive: true, isPatient: true, platformMrn: true },
    });
    if (!person || !person.isActive) {
      throw new PatientAccountInactiveException(credentials.personId);
    }

    const passwordMatch = await this.passwordService.verify(
      dto.password,
      credentials.passwordHash,
    );
    if (!passwordMatch) {
      await this.registerFailedAttempt(credentials.id);
      throw new PatientInvalidCredentialsException();
    }

    // Only people actually enrolled as a patient somewhere may use the portal —
    // a staff-only person sharing this credential row must use business login.
    if (!person.isPatient) {
      throw new PatientNoLoginAccessException(person.id);
    }

    const businesses = await this.resolveBusinesses(person.id);
    if (businesses.length === 0) {
      throw new PatientNoLoginAccessException(person.id);
    }

    await this.prisma.personCredentials.update({
      where: { id: credentials.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: clientIp,
      },
    });

    const bootstrapPayload: PatientBootstrapPayload = {
      type: PATIENT_BOOTSTRAP_TOKEN_TYPE,
      person_id: person.id,
      platform_mrn: person.platformMrn,
      must_change_password: credentials.isTempPassword,
    };
    const bootstrapToken = this.jwtService.sign(bootstrapPayload, {
      expiresIn: this.bootstrapTtl,
    });
    this.logger.log(`Patient login: person ${person.id} from ${clientIp}`);
    return {
      bootstrapToken,
      mustChangePassword: credentials.isTempPassword,
      businesses,
    };
  }

  /**
   * Step 2 — exchange a bootstrap token + chosen tenant for a tenant-scoped
   * access + refresh pair. The tenant is validated against the person's
   * enrolments (a client cannot pick a business they are not a patient of).
   * @param dto bootstrap token + chosen tenant id
   * @param clientIp client IP (audit)
   * @returns `{ accessToken, refreshToken, patient, mustChangePassword }`
   * @throws PatientInvalidBootstrapTokenException on a bad/expired bootstrap token
   * @throws PatientTenantNotSelectableException when the tenant isn't enrolled
   * @throws PatientNoLoginAccessException when no patient row exists in the tenant
   */
  async selectBusiness(
    dto: SelectBusinessDto,
    clientIp: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    patient: PatientSessionSummary;
    mustChangePassword: boolean;
  }> {
    const bootstrap = this.verifyBootstrapToken(dto.bootstrapToken);
    return this.issueSessionForTenant(
      bootstrap.person_id,
      dto.tenantId,
      clientIp,
    );
  }

  /**
   * Switch an already-authenticated patient session to another of the patient's
   * businesses, issuing a fresh access + refresh pair scoped to the target
   * tenant — no re-login (mirrors business `switch-profile`). Blocked on a
   * temp-password session by the guard (not `@AllowTempPassword`).
   * @param personId the authenticated patient's person id (from the token)
   * @param dto the target tenant to switch into
   * @param clientIp client IP (audit)
   * @throws PatientTenantNotSelectableException when the tenant isn't enrolled
   */
  async switchBusiness(
    personId: string,
    dto: SwitchBusinessDto,
    clientIp: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    patient: PatientSessionSummary;
    mustChangePassword: boolean;
  }> {
    return this.issueSessionForTenant(personId, dto.tenantId, clientIp);
  }

  /**
   * Validate the person's enrolment in the target tenant, resolve their patient
   * row there, and issue a tenant-scoped access + refresh pair. Shared by
   * `selectBusiness` (post-login) and `switchBusiness` (in-session).
   */
  private async issueSessionForTenant(
    personId: string,
    tenantId: string,
    clientIp: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    patient: PatientSessionSummary;
    mustChangePassword: boolean;
  }> {
    const enrolment = await this.prisma.personTenantEnrollment.findFirst({
      where: { personId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!enrolment) {
      throw new PatientTenantNotSelectableException(tenantId);
    }

    const person = await this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: { id: true, isActive: true, platformMrn: true },
    });
    if (!person || !person.isActive) {
      throw new PatientAccountInactiveException(personId);
    }

    const patient = await this.resolvePatientInTenant(tenantId, person.id);
    if (!patient) {
      throw new PatientNoLoginAccessException(person.id);
    }

    // Re-read the live temp-password flag (a bootstrap/token may be stale).
    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId: person.id },
      select: { isTempPassword: true },
    });
    const mustChangePassword = credentials?.isTempPassword ?? false;

    const summary: PatientSessionSummary = {
      patientId: patient.id,
      personId: person.id,
      tenantId,
      branchId: patient.branchId,
      platformMrn: person.platformMrn,
      name: this.composeName(patient),
    };
    const tokens = await this.issuePatientTokens(
      summary,
      mustChangePassword,
      clientIp,
    );
    this.logger.log(
      `Patient session: person ${person.id} entered tenant ${tenantId} from ${clientIp}`,
    );
    return { ...tokens, patient: summary, mustChangePassword };
  }

  /**
   * Rotate a patient refresh token for a new access + refresh pair. Single-use:
   * the old token is marked used, then the person/enrolment/patient are
   * re-validated against current state before a new pair is issued. Rejects any
   * token that is not a patient token.
   * @param refreshTokenValue raw refresh token from the client
   * @param clientIp client IP (audit)
   */
  async refresh(
    refreshTokenValue: string,
    clientIp: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    mustChangePassword: boolean;
  }> {
    const tokenHash = this.hashToken(refreshTokenValue);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, deletedAt: null },
    });
    if (
      !stored ||
      stored.tokenType !== PATIENT_TOKEN_TYPE ||
      !stored.tenantId ||
      stored.isUsed ||
      stored.isRevoked ||
      stored.expiresAt < new Date()
    ) {
      throw new PatientInvalidRefreshTokenException();
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isUsed: true },
    });

    const person = await this.prisma.person.findFirst({
      where: { id: stored.personId, deletedAt: null },
      select: { id: true, isActive: true, platformMrn: true },
    });
    if (!person || !person.isActive) {
      throw new PatientAccountInactiveException(stored.personId);
    }

    const enrolment = await this.prisma.personTenantEnrollment.findFirst({
      where: {
        personId: person.id,
        tenantId: stored.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const patient = enrolment
      ? await this.resolvePatientInTenant(stored.tenantId, person.id)
      : null;
    if (!patient) {
      throw new PatientInvalidRefreshTokenException();
    }

    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId: person.id },
      select: { isTempPassword: true },
    });
    const mustChangePassword = credentials?.isTempPassword ?? false;

    const summary: PatientSessionSummary = {
      patientId: patient.id,
      personId: person.id,
      tenantId: stored.tenantId,
      branchId: patient.branchId,
      platformMrn: person.platformMrn,
      name: this.composeName(patient),
    };
    const tokens = await this.issuePatientTokens(
      summary,
      mustChangePassword,
      clientIp,
    );
    return { ...tokens, mustChangePassword };
  }

  /**
   * Change the patient's password (requires the current one). Clears the
   * temp-password flag so the session is no longer restricted to change-password,
   * and revokes existing patient sessions so the new password takes effect
   * everywhere.
   * @param personId the authenticated patient's person id
   * @param dto current + new password
   * @throws PatientInvalidCredentialsException when the current password is wrong
   * @throws InvalidPasswordException when the new password fails policy
   */
  async changePassword(
    personId: string,
    dto: ChangePatientPasswordDto,
  ): Promise<void> {
    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId },
    });
    if (!credentials) {
      throw new PatientInvalidCredentialsException();
    }
    const currentMatch = await this.passwordService.verify(
      dto.currentPassword,
      credentials.passwordHash,
    );
    if (!currentMatch) {
      throw new PatientInvalidCredentialsException();
    }
    const policyError = this.passwordService.validate(dto.newPassword);
    if (policyError) {
      throw new InvalidPasswordException(policyError);
    }
    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.personCredentials.update({
      where: { personId },
      data: { passwordHash: newHash, isTempPassword: false },
    });
    await this.revokePatientTokens(personId);
    this.logger.log(`Patient password changed for person ${personId}`);
  }

  /**
   * Log out of the patient portal everywhere (revokes the person's patient
   * refresh tokens; business sessions, if any, are untouched).
   * @param personId the authenticated patient's person id
   */
  async logout(personId: string): Promise<void> {
    await this.revokePatientTokens(personId);
    this.logger.log(`Patient logout for person ${personId}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Increment the failed-attempt counter and lock the account once the ceiling
   * is reached. Mirrors business/SiteAdmin lockout exactly.
   */
  private async registerFailedAttempt(credentialsId: string): Promise<void> {
    const updated = await this.prisma.personCredentials.update({
      where: { id: credentialsId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000);
      await this.prisma.personCredentials.update({
        where: { id: credentialsId },
        data: { lockedUntil },
      });
      throw new PatientAccountLockedException(lockedUntil);
    }
  }

  /**
   * List the businesses a person may enter, from the platform-level (RLS-exempt)
   * `person_tenant_enrollments` index joined to `tenants`. This avoids reading
   * the RLS-scoped `patients` table, which returns nothing without a tenant
   * context (there is none yet at login).
   */
  private async resolveBusinesses(
    personId: string,
  ): Promise<SelectableBusiness[]> {
    const enrolments = await this.prisma.personTenantEnrollment.findMany({
      where: { personId, deletedAt: null },
      select: { tenantId: true },
    });
    const tenantIds = [...new Set(enrolments.map((e) => e.tenantId))];
    if (tenantIds.length === 0) {
      return [];
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        shortName: true,
        logoUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    return tenants.map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      tenantSlug: t.slug,
      shortName: t.shortName,
      logoUrl: t.logoUrl,
    }));
  }

  /**
   * Fetch the patient's row within a specific tenant under that tenant's RLS
   * context (`runWithTenant`), so the scoped read resolves its row-level policy.
   */
  private resolvePatientInTenant(
    tenantId: string,
    personId: string,
  ): Promise<{
    id: string;
    branchId: string | null;
    salutation: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
  } | null> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.patient.findFirst({
        where: { tenantId, personId, deletedAt: null },
        select: {
          id: true,
          branchId: true,
          salutation: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      }),
    );
  }

  /** Verify + type a bootstrap token, mapping any failure to a typed 401. */
  private verifyBootstrapToken(token: string): PatientBootstrapPayload {
    let payload: PatientBootstrapPayload;
    try {
      payload = this.jwtService.verify<PatientBootstrapPayload>(token);
    } catch {
      throw new PatientInvalidBootstrapTokenException();
    }
    if (payload.type !== PATIENT_BOOTSTRAP_TOKEN_TYPE || !payload.person_id) {
      throw new PatientInvalidBootstrapTokenException();
    }
    return payload;
  }

  /**
   * Sign a patient access token and persist a single-use refresh token (random,
   * stored only as a SHA-256 hash) tagged with the patient audience + tenant.
   */
  private async issuePatientTokens(
    summary: PatientSessionSummary,
    mustChangePassword: boolean,
    clientIp: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: PatientJwtPayload = {
      type: PATIENT_ACCESS_TOKEN_TYPE,
      person_id: summary.personId,
      patient_id: summary.patientId,
      tenant_id: summary.tenantId,
      active_branch_id: summary.branchId,
      platform_mrn: summary.platformMrn,
      is_patient_context: true,
      must_change_password: mustChangePassword,
    };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.accessTtl,
    });

    const rawRefreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshDays);
    await this.prisma.refreshToken.create({
      data: {
        personId: summary.personId,
        tokenHash: this.hashToken(rawRefreshToken),
        tokenType: PATIENT_TOKEN_TYPE,
        tenantId: summary.tenantId,
        branchId: summary.branchId,
        issuedToIp: clientIp,
        expiresAt,
        isUsed: false,
        isRevoked: false,
      },
    });
    return { accessToken, refreshToken: rawRefreshToken };
  }

  /** SHA-256 hash a refresh token for storage (raw tokens are never stored). */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Revoke all of a person's active patient refresh tokens. */
  private async revokePatientTokens(personId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { personId, tokenType: PATIENT_TOKEN_TYPE, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  /** Compose a display name from the patient's name parts. */
  private composeName(patient: {
    salutation: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
  }): string {
    return [
      patient.salutation,
      patient.firstName,
      patient.middleName,
      patient.lastName,
    ]
      .filter((part): part is string => !!part && part.trim().length > 0)
      .join(' ');
  }
}
