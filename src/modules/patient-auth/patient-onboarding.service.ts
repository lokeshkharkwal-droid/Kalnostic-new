import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { MessagingChannel, RecipientType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationService } from '../communication/communication.service';
import {
  PatientCredentialResult,
  PatientCredentialService,
} from './patient-credential.service';
import { PATIENT_TEMP_PASSWORD } from './constants/patient-auth.constant';

/**
 * Emitted by `PatientService` after a `Patient` row (and its platform `Person`)
 * commit, from every registration workflow (`POST /patients`, the quotation
 * patient route, and the Create-Order inline patient — all funnel through
 * `PatientService.create`). The patient is already persisted when this fires, so
 * downstream onboarding is a safe, post-commit side effect.
 */
export interface PatientCreatedEvent {
  /** Tenant the patient was registered in (from the JWT context). */
  tenantId: string;
  /** Registration branch, or `null` for a tenant-level patient. */
  branchId: string | null;
  /** The newly-created patient's id. */
  patientId: string;
  /** Acting staff person (JWT `person_id`), or `null` if none. */
  actorId: string | null;
}

/** What {@link PatientOnboardingService.onboardNewPatient} did (for tests/metrics). */
export interface PatientOnboardingOutcome {
  /** A brand-new portal login was generated now. */
  loginCreated: boolean;
  /** A credentials email was queued for delivery. */
  emailQueued: boolean;
  /** Why a step was skipped, or `null` when everything ran. */
  skippedReason:
    | 'login_not_possible'
    | 'login_already_existed'
    | 'no_email'
    | 'email_enqueue_failed'
    | null;
}

/** Internal fields needed to compose the credentials email. */
interface PatientEmailContact {
  email: string | null;
  name: string;
  tenantName: string | null;
}

/** Frontend path that renders the patient-portal login screen. */
const PATIENT_LOGIN_PATH = '/patient/login';

/**
 * `enrolledBy` sentinel used when a patient is auto-onboarded without an
 * identifiable staff actor (e.g. a system/background registration). Mirrors the
 * `patient-login-backfill` precedent in `scripts/enable-patient-login.ts`; the
 * column is nullable free-text (not a `Person` FK), so a sentinel is safe.
 */
const AUTO_ONBOARD_ACTOR = 'auto-registration';

/**
 * Centralized patient-onboarding side effects. Reacts to `patient.created` and,
 * for every newly-registered patient, auto-provisions a patient-portal login and
 * emails the temporary credentials — reusing the existing patient-auth
 * (`PatientCredentialService`) and Exchange (`CommunicationService`)
 * architecture. One place, so the three registration workflows (Patient
 * Registration, Patient Management, Create-Order inline patient) stay
 * consistent without duplicating logic in controllers.
 *
 * Guarantees:
 * - **Idempotent / no duplicates** — delegates to the idempotent
 *   `ensureLoginCredentials`; a patient who already has a login is only enrolled
 *   in this tenant, never re-issued a password.
 * - **Non-destructive** — it never throws, so a login or email failure can never
 *   roll back (or be retried into duplicating) the already-committed patient.
 * - **Email only for a NEW login** — an existing login (e.g. the same person is
 *   already a patient at another business) never triggers a credentials email.
 * - **Graceful with no email** — a patient without an email still gets a login;
 *   the notification is skipped and the reason logged.
 */
@Injectable()
export class PatientOnboardingService {
  private readonly logger = new Logger(PatientOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly patientCredentialService: PatientCredentialService,
    private readonly communicationService: CommunicationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `patient.created` handler — auto-onboard the new patient. An `@OnEvent`
   * handler must never leak a rejection (the emit is fire-and-forget), so this
   * swallows everything; {@link onboardNewPatient} is already non-throwing, this
   * is belt-and-braces.
   * @param event the newly-created patient's identity + context
   */
  @OnEvent('patient.created')
  async handlePatientCreated(event: PatientCreatedEvent): Promise<void> {
    try {
      await this.onboardNewPatient(
        event.tenantId,
        event.patientId,
        event.actorId,
        event.branchId,
      );
    } catch (err) {
      this.logger.error(
        `patient.created onboarding failed for patient ${event.patientId}: ${this.describe(err)}`,
      );
    }
  }

  /**
   * Ensure the patient has a portal login and, only when a NEW login is
   * generated, email them the temporary credentials. Reusable and safe to call
   * directly. Never throws — the caller's patient creation must not be affected
   * by a login/email failure.
   * @param tenantId tenant scope (from the registration context)
   * @param patientId the just-created patient
   * @param actorId acting staff person (enrolment/audit trail), or `null`
   * @param branchId registration branch (for the communication log), or `null`
   * @returns an outcome describing what happened
   */
  async onboardNewPatient(
    tenantId: string,
    patientId: string,
    actorId: string | null,
    branchId: string | null,
  ): Promise<PatientOnboardingOutcome> {
    const enrolledBy = actorId ?? AUTO_ONBOARD_ACTOR;

    let credential: PatientCredentialResult;
    try {
      credential = await this.patientCredentialService.ensureLoginCredentials(
        tenantId,
        patientId,
        enrolledBy,
        { reset: false },
      );
    } catch (err) {
      // Most commonly PatientHasNoLoginIdentifierException — no phone AND no
      // email, so no login can exist. A login simply isn't provisioned.
      this.logger.warn(
        `Patient-login generation skipped for patient ${patientId}: ${this.describe(err)}`,
      );
      return {
        loginCreated: false,
        emailQueued: false,
        skippedReason: 'login_not_possible',
      };
    }

    if (credential.credentialsAlreadyExisted) {
      // The person already had a login (e.g. already a patient at another
      // business, or a staff+patient hybrid). They were enrolled in this tenant;
      // do NOT resend credentials.
      this.logger.log(
        `Patient ${patientId} already had a portal login; enrolled in tenant ${tenantId}, no credentials email sent.`,
      );
      return {
        loginCreated: false,
        emailQueued: false,
        skippedReason: 'login_already_existed',
      };
    }

    // A fresh login was generated — email the temp credentials to the patient's
    // registered email (if any).
    const contact = await this.loadPatientContact(tenantId, patientId);
    const email = contact.email?.trim() || null;
    if (!email) {
      this.logger.warn(
        `Patient ${patientId} portal login created, but no email on record — credentials email skipped.`,
      );
      return {
        loginCreated: true,
        emailQueued: false,
        skippedReason: 'no_email',
      };
    }

    const emailQueued = await this.sendCredentialsEmail({
      tenantId,
      branchId,
      actorId,
      patientId,
      toEmail: email,
      recipientName: contact.name,
      tenantName: contact.tenantName,
      loginIdentifier: credential.loginIdentifier,
      tempPassword: credential.tempPassword ?? PATIENT_TEMP_PASSWORD,
    });

    return {
      loginCreated: true,
      emailQueued,
      skippedReason: emailQueued ? null : 'email_enqueue_failed',
    };
  }

  /**
   * Load the just-created patient's email + display name (tenant-scoped read
   * under RLS) and the tenant's name (platform-level) for the email body.
   */
  private async loadPatientContact(
    tenantId: string,
    patientId: string,
  ): Promise<PatientEmailContact> {
    const patient = await this.prisma.withTenant(tenantId, (tx) =>
      tx.patient.findFirst({
        where: { id: patientId, tenantId, deletedAt: null },
        select: {
          email: true,
          salutation: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      }),
    );
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return {
      email: patient?.email ?? null,
      name: this.composeName(patient),
      tenantName: tenant?.name ?? null,
    };
  }

  /**
   * Queue the credentials email through the Exchange-backed communication
   * pipeline (persisted as a `CommunicationLog`, delivered + retried by the
   * background worker). Returns `false` — never throws — when the enqueue is
   * rejected (e.g. the tenant isn't registered with the Exchange), so the login
   * still succeeds and the failure is logged for a later retry.
   */
  private async sendCredentialsEmail(params: {
    tenantId: string;
    branchId: string | null;
    actorId: string | null;
    patientId: string;
    toEmail: string;
    recipientName: string;
    tenantName: string | null;
    loginIdentifier: string;
    tempPassword: string;
  }): Promise<boolean> {
    try {
      await this.communicationService.enqueue(
        params.tenantId,
        params.branchId,
        {
          channel: MessagingChannel.EMAIL,
          subject: 'Your patient portal login details',
          body: this.buildCredentialsEmailHtml({
            patientName: params.recipientName,
            tenantName: params.tenantName,
            loginUrl: this.patientLoginUrl(),
            loginIdentifier: params.loginIdentifier,
            tempPassword: params.tempPassword,
          }),
          recipients: [
            {
              recipientType: RecipientType.PATIENT,
              recipientId: params.patientId,
              recipientName: params.recipientName || undefined,
              toAddress: params.toEmail,
            },
          ],
        },
        params.actorId ?? undefined,
      );
      this.logger.log(
        `Queued patient-login credentials email for patient ${params.patientId} to ${params.toEmail}.`,
      );
      return true;
    } catch (err) {
      // Enqueue rejects when the tenant isn't registered with the Exchange (or a
      // transient DB error). The login is already created; log so it can be
      // retried (e.g. once the tenant is registered) without blocking signup.
      this.logger.warn(
        `Patient-login credentials email not queued for patient ${params.patientId}: ${this.describe(err)}`,
      );
      return false;
    }
  }

  /**
   * Build the HTML credentials email. Uses INLINE styles only (no `<style>`
   * block and no `{token}` sequences) so it renders reliably in email clients
   * and is left untouched by the communication pipeline's placeholder filler.
   */
  private buildCredentialsEmailHtml(params: {
    patientName: string;
    tenantName: string | null;
    loginUrl: string;
    loginIdentifier: string;
    tempPassword: string;
  }): string {
    const logoUrl = this.brandLogoUrl();
    const greetingName = this.escapeHtml(params.patientName || 'Patient');
    const business = params.tenantName
      ? this.escapeHtml(params.tenantName)
      : null;
    const identifier = this.escapeHtml(params.loginIdentifier);
    const password = this.escapeHtml(params.tempPassword);
    const loginUrl = this.escapeHtml(params.loginUrl);

    return [
      '<div style="margin:0;padding:0;background-color:#f4f6f8;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '<tr><td align="center">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">',
      // Header / logo
      '<tr><td align="center" style="background-color:#ffffff;padding:24px 24px 8px 24px;border-bottom:1px solid #eef0f3;">',
      `<img src="${this.escapeHtml(logoUrl)}" alt="Kalnostics" height="44" style="height:44px;max-width:220px;display:block;border:0;outline:none;text-decoration:none;" />`,
      '</td></tr>',
      // Body
      '<tr><td style="padding:28px 32px 8px 32px;">',
      '<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:#111827;">Your patient portal account is ready</h1>',
      `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;">Dear ${greetingName},</p>`,
      `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;">A patient portal login has been created for you${business ? ` at <strong>${business}</strong>` : ''}. Use the temporary credentials below to sign in.</p>`,
      // Credentials card
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 20px 0;">',
      '<tr><td style="padding:16px 20px;font-size:14px;line-height:1.8;">',
      `<div style="margin:0 0 6px 0;"><span style="color:#6b7280;">Login&nbsp;ID:</span> <strong style="color:#111827;">${identifier}</strong></div>`,
      `<div style="margin:0;"><span style="color:#6b7280;">Temporary&nbsp;password:</span> <strong style="color:#111827;">${password}</strong></div>`,
      '</td></tr></table>',
      // CTA button
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;"><tr><td align="center" style="border-radius:6px;background-color:#2563eb;">',
      `<a href="${loginUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">Log in to the patient portal</a>`,
      '</td></tr></table>',
      `<p style="margin:0 0 20px 0;font-size:13px;line-height:1.6;color:#4b5563;">Or open this link: <a href="${loginUrl}" target="_blank" style="color:#2563eb;">${loginUrl}</a></p>`,
      // Security note
      '<p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#b45309;"><strong>For your security, please change this temporary password right after your first login.</strong></p>',
      '<p style="margin:0 0 4px 0;font-size:13px;line-height:1.6;color:#6b7280;">If you did not expect this email, please contact your laboratory.</p>',
      '</td></tr>',
      // Footer
      '<tr><td style="padding:16px 32px 28px 32px;border-top:1px solid #eef0f3;">',
      '<p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">This is an automated message — please do not reply.</p>',
      '</td></tr>',
      '</table>',
      '</td></tr></table>',
      '</div>',
    ].join('');
  }

  /** The patient-portal login URL, from `FRONTEND_URL` + the login path. */
  private patientLoginUrl(): string {
    const base = (
      this.config.get<string>('exchange.frontendUrl') ?? 'http://localhost:8080'
    ).replace(/\/+$/, '');
    return `${base}${PATIENT_LOGIN_PATH}`;
  }

  /**
   * The Kalnostics logo URL for the email header: `BRAND_LOGO_URL` when set,
   * else `FRONTEND_URL/logo.png` (the frontend serves the brand logo there).
   */
  private brandLogoUrl(): string {
    const override = this.config.get<string>('branding.logoUrl');
    if (override && override.trim()) {
      return override.trim();
    }
    const base = (
      this.config.get<string>('exchange.frontendUrl') ?? 'http://localhost:8080'
    ).replace(/\/+$/, '');
    return `${base}/logo.png`;
  }

  /** Compose a display name from the patient's name parts. */
  private composeName(
    patient: {
      salutation: string | null;
      firstName: string;
      middleName: string | null;
      lastName: string | null;
    } | null,
  ): string {
    if (!patient) {
      return '';
    }
    return [
      patient.salutation,
      patient.firstName,
      patient.middleName,
      patient.lastName,
    ]
      .filter((part): part is string => !!part && part.trim().length > 0)
      .join(' ');
  }

  /** Minimal HTML-escaping for values interpolated into the email body. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Readable one-line description of an unknown thrown value, for logs. */
  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
