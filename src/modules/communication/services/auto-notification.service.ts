import { Injectable, Logger } from '@nestjs/common';
import {
  MessagingChannel,
  NotificationKind,
  RecipientType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommunicationService } from '../communication.service';
import { NotificationService } from '../notification.service';
import { TemplateService } from '../../template/template.service';

/** A recipient's pre-resolved contact for an automatic notification. */
export interface RecipientContact {
  recipientType: RecipientType;
  recipientId?: string;
  name: string;
  email?: string | null;
  mobile?: string | null;
  whatsappNumber?: string | null;
}

/** An in-app (IAM) target — a person addressed in the notification bell. */
export interface IamTarget {
  entityId: string;
  entityType: string;
  name?: string;
}

/** A single automatic notification to dispatch across channels. */
export interface AutoNotificationSpec {
  /** FEATURE_TYPES key used to resolve the per-channel `Template`. */
  feature: string;
  /** Notification `verb` (machine tag) for the in-app row. */
  verb: string;
  /** Email subject / in-app subject. */
  subject: string;
  /** `{placeholder}` → value map for template substitution (WITHOUT braces). */
  variables?: Record<string, string>;
  /**
   * Body used for the in-app alert and for Email when no `Template` is
   * configured for that channel — so notifications keep working before any
   * template rows are seeded (SMS/WhatsApp have no free-text fallback because
   * they need provider template ids).
   */
  fallbackHtml: (name: string) => string;
  /**
   * Deliverable channels to attempt for this notification. Defaults to all of
   * {@link DELIVERABLE_CHANNELS} (Email / SMS / WhatsApp). Pass a subset to
   * restrict delivery (e.g. `[EMAIL, SMS]` for events that must not go over
   * WhatsApp) regardless of which `Template` rows happen to exist.
   */
  channels?: MessagingChannel[];
  /** Optional in-app context link (e.g. the order id). */
  contextId?: string;
  contextType?: string;
}

/** Deliverable channels attempted, in order, for every notification. */
const DELIVERABLE_CHANNELS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
];

/**
 * Reusable automatic-notification dispatcher. Given a business event's recipient
 * + a feature-keyed spec, it raises an in-app (IAM) alert (when targets are
 * given) and sends over every deliverable channel (Email / SMS / WhatsApp) the
 * tenant has activated a `Template` for. Per channel: the body + SMS/WhatsApp
 * provider metadata come from the resolved `Template`; Email falls back to a
 * free-text body when no template exists (so it works before templates are
 * seeded); SMS/WhatsApp are skipped when no template is configured (they need
 * provider template ids). Everything is fire-and-forget: the call, the IAM, and
 * each channel swallow + log their own errors so a messaging failure never
 * affects the (already-committed) business operation. All DB access runs inside
 * `withTenant`, so out-of-request callers (event listeners, crons) set the RLS
 * tenant GUC correctly.
 */
@Injectable()
export class AutoNotificationService {
  private readonly logger = new Logger(AutoNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly communication: CommunicationService,
    private readonly notifications: NotificationService,
    private readonly templates: TemplateService,
  ) {}

  /**
   * Dispatch to a patient: resolve their contact, raise a patient-targeted IAM,
   * and send over Email/SMS/WhatsApp. No-op if the patient can't be resolved.
   */
  async dispatchToPatient(
    tenantId: string,
    branchId: string | null,
    patientId: string,
    spec: AutoNotificationSpec,
  ): Promise<void> {
    const patient = await this.resolvePatient(tenantId, patientId);
    if (!patient) return;
    await this.dispatch(
      tenantId,
      branchId,
      {
        recipientType: RecipientType.PATIENT,
        recipientId: patient.id,
        name: patient.name,
        email: patient.email,
        mobile: patient.mobile,
        whatsappNumber: patient.whatsappNumber,
      },
      spec,
      [{ entityId: patientId, entityType: 'PATIENT', name: patient.name }],
    );
  }

  /**
   * Dispatch to an arbitrary, pre-resolved recipient (e.g. a referral panel or a
   * doctor). IAM is raised only when `opts.iamTargets` is supplied (external
   * parties with no notification bell get Email/SMS/WhatsApp only).
   */
  async dispatchToContact(
    tenantId: string,
    branchId: string | null,
    recipient: RecipientContact,
    spec: AutoNotificationSpec,
    opts?: { iamTargets?: IamTarget[] },
  ): Promise<void> {
    await this.dispatch(tenantId, branchId, recipient, spec, opts?.iamTargets);
  }

  /** Core: IAM (if targets) + every deliverable channel. */
  private async dispatch(
    tenantId: string,
    branchId: string | null,
    recipient: RecipientContact,
    spec: AutoNotificationSpec,
    iamTargets?: IamTarget[],
  ): Promise<void> {
    try {
      const name = recipient.name || 'there';
      const variables: Record<string, string> = {
        pn: name,
        patient_name: name,
        ...(spec.variables ?? {}),
      };
      const fallbackBody = spec.fallbackHtml(name);

      if (iamTargets && iamTargets.length > 0) {
        await this.dispatchIam(
          tenantId,
          branchId,
          iamTargets,
          spec,
          variables,
          fallbackBody,
        );
      }

      for (const channel of spec.channels ?? DELIVERABLE_CHANNELS) {
        await this.dispatchChannel(
          tenantId,
          branchId,
          recipient,
          channel,
          this.addressFor(recipient, channel),
          spec,
          variables,
          // Email keeps a free-text fallback so it works pre-templates; SMS and
          // WhatsApp are skipped when no template (they need provider ids).
          channel === MessagingChannel.EMAIL ? fallbackBody : null,
        );
      }
    } catch (err: unknown) {
      this.logError('ALL', recipient.recipientId ?? '-', spec.verb, err);
    }
  }

  /** The recipient's address for a given channel, or null when absent. */
  private addressFor(
    recipient: RecipientContact,
    channel: MessagingChannel,
  ): string | null {
    if (channel === MessagingChannel.EMAIL) return recipient.email ?? null;
    if (channel === MessagingChannel.WHATSAPP)
      return recipient.whatsappNumber ?? recipient.mobile ?? null;
    return recipient.mobile ?? null; // SMS
  }

  /** Raise the in-app (IAM) alert. */
  private async dispatchIam(
    tenantId: string,
    branchId: string | null,
    targets: IamTarget[],
    spec: AutoNotificationSpec,
    variables: Record<string, string>,
    fallbackBody: string,
  ): Promise<void> {
    try {
      const iamTemplate = await this.templates.resolveForDelivery(
        tenantId,
        branchId,
        MessagingChannel.IAM,
        spec.feature,
      );
      const body = iamTemplate
        ? this.fill(iamTemplate.template, variables)
        : fallbackBody;
      await this.notifications.create(
        tenantId,
        branchId,
        {
          kind: NotificationKind.ALERT,
          verb: spec.verb,
          subject: spec.subject,
          body,
          ...(spec.contextId ? { contextId: spec.contextId } : {}),
          ...(spec.contextType ? { contextType: spec.contextType } : {}),
          targets,
        },
        { entityId: 'system', entityType: 'SYSTEM', name: 'System' },
      );
    } catch (err: unknown) {
      this.logError('IAM', targets[0]?.entityId ?? '-', spec.verb, err);
    }
  }

  /**
   * Enqueue one deliverable channel. Uses the tenant's activated `Template`
   * (by feature + channel) so the body + SMS/WhatsApp provider metadata are
   * attached. When no template exists: Email sends `emailFallbackBody`;
   * SMS/WhatsApp are skipped.
   */
  private async dispatchChannel(
    tenantId: string,
    branchId: string | null,
    recipient: RecipientContact,
    channel: MessagingChannel,
    toAddress: string | null,
    spec: AutoNotificationSpec,
    variables: Record<string, string>,
    emailFallbackBody: string | null,
  ): Promise<void> {
    if (!toAddress) return;
    const recipients = [
      {
        recipientType: recipient.recipientType,
        recipientId: recipient.recipientId,
        recipientName: recipient.name,
        toAddress,
      },
    ];
    try {
      const template = await this.templates.resolveForDelivery(
        tenantId,
        branchId,
        channel,
        spec.feature,
      );
      if (template) {
        // Pass `feature` (NOT `templateId`) so enqueue re-resolves via
        // resolveForDelivery — which handles SITE_ADMIN global templates
        // (tenant_id NULL). Passing templateId would make enqueue re-fetch it
        // scoped to the caller's tenant, which never matches a global and throws
        // TemplateNotFound. The feature path still attaches the SMS/WhatsApp
        // provider metadata from the resolved template.
        await this.communication.enqueue(
          tenantId,
          branchId,
          {
            channel,
            feature: spec.feature,
            subject: spec.subject,
            recipients,
            variables,
          },
          'system',
        );
      } else if (emailFallbackBody !== null) {
        await this.communication.enqueue(
          tenantId,
          branchId,
          {
            channel,
            feature: spec.feature,
            subject: spec.subject,
            body: emailFallbackBody,
            recipients,
          },
          'system',
        );
      }
      // else: no template for SMS/WhatsApp → skip silently.
    } catch (err: unknown) {
      this.logError(channel, recipient.recipientId ?? '-', spec.verb, err);
    }
  }

  /** Substitute `{key}` placeholders; unmatched tokens are left untouched. */
  private fill(raw: string, vars: Record<string, string>): string {
    return raw.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = vars[k];
      return v !== undefined ? v : m;
    });
  }

  /** Log (and swallow) a per-channel failure. */
  private logError(
    channel: string,
    recipientId: string,
    verb: string,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `Failed to notify ${recipientId} (${verb}) via ${channel}: ${message}`,
    );
  }

  /** Look up a patient's name + contacts, tenant-scoped (RLS via withTenant). */
  private async resolvePatient(
    tenantId: string,
    patientId: string,
  ): Promise<{
    id: string;
    name: string;
    email: string | null;
    mobile: string | null;
    whatsappNumber: string | null;
  } | null> {
    const p = await this.prisma.withTenant(tenantId, (tx) =>
      tx.patient.findFirst({
        where: { id: patientId, tenantId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          mobile: true,
          whatsappNumber: true,
        },
      }),
    );
    if (!p) return null;
    return {
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
      email: p.email,
      mobile: p.mobile,
      whatsappNumber: p.whatsappNumber,
    };
  }
}
