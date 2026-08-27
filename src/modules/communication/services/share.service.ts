import { Injectable, Logger } from '@nestjs/common';
import {
  CommunicationLog,
  MessagingChannel,
  NotificationKind,
  RecipientType,
} from '@prisma/client';
import { CommunicationService } from '../communication.service';
import { NotificationService } from '../notification.service';
import { TemplateService } from '../../template/template.service';
import {
  ShareTemplateNotActivatedException,
  ShareTemplateNotConfiguredException,
  ShareRecipientMissingException,
} from '../exceptions/communication.exceptions';

/**
 * The party a document is shared with over the deliverable channels
 * (Email/SMS/WhatsApp). The three contact fields are pre-resolved by the caller
 * (e.g. patient email/mobile/whatsapp, or a referral panel's accounts-person
 * contact) so this service stays domain-agnostic.
 */
export interface ShareRecipient {
  recipientId?: string | null;
  recipientName?: string | null;
  type: RecipientType;
  email?: string | null;
  sms?: string | null;
  whatsapp?: string | null;
}

/** One in-app (IAM) notification target — a person who receives the alert. */
export interface ShareIamTarget {
  entityId: string;
  entityType: string; // 'STAFF' | 'PATIENT' | …
  name?: string | null;
}

/** IAM copy + sender overrides used when the template carries no display title. */
export interface ShareIamConfig {
  verb: string;
  subject: string;
  /** `entityType` recorded for the sender/actor when `actorId` is present (default 'USER'). */
  actorEntityType?: string;
}

/** Outcome of a single channel within a multi-channel ("Send All") share. */
export interface ShareChannelResult {
  channel: MessagingChannel;
  /** QUEUED = handed to the queue/in-app; SKIPPED = no template/recipient; FAILED = error. */
  status: 'QUEUED' | 'SKIPPED' | 'FAILED';
  /** Human-readable reason for a SKIPPED/FAILED channel (absent when QUEUED). */
  reason?: string;
  /** Communication-log id (deliverable channels) or notification id (IAM). */
  logId?: string;
}

/** Per-channel availability + default recipient for a Share popup preload. */
export interface ShareChannelInfo {
  channel: MessagingChannel;
  /** True when the tenant has an activated template for this channel + feature. */
  activated: boolean;
  /** The default contact for this channel (null when none is available). */
  toAddress: string | null;
}

/**
 * Reusable "Share and Inform" engine (extracted from the Order Console lab-report
 * share so every share flow — lab report, order bill, … — uses one core). Given a
 * `feature` key + channel it resolves the tenant's ACTIVATED messaging template
 * (no template picker, no global fallback), fills placeholders, and delivers:
 * Email/SMS/WhatsApp through the Exchange queue (`CommunicationService`), the
 * in-app IAM message through `NotificationService`. Callers supply the recipient
 * contacts, an optional PDF-attachment provider, and the template `{variables}` —
 * this service holds no domain knowledge.
 */
@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    private readonly communicationService: CommunicationService,
    private readonly notificationService: NotificationService,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Resolve + enqueue a single deliverable-channel (Email/SMS/WhatsApp) share,
   * using the tenant's ACTIVATED `feature` template for `channel`. Email/WhatsApp
   * carry the rendered PDF (from `getPdf`); SMS is text-only.
   *
   * @throws ShareTemplateNotActivatedException if the channel has no activated template
   * @throws ShareTemplateNotConfiguredException if the template lacks SMS/WhatsApp carrier ids
   * @throws ShareRecipientMissingException if no destination is available
   */
  async dispatchDeliverable(
    tenantId: string,
    branchId: string | null,
    feature: string,
    channel: MessagingChannel,
    recipient: ShareRecipient,
    toAddressOverride: string | undefined,
    actorId: string,
    getPdf?: () => Promise<string>,
    variables: Record<string, string> = {},
    attachmentName = 'document.pdf',
  ): Promise<CommunicationLog[]> {
    // 1. Only a tenant-ACTIVATED template for this channel may be used.
    const template = await this.templateService.resolveActivatedTemplate(
      tenantId,
      branchId,
      channel,
      feature,
    );
    if (!template) {
      throw new ShareTemplateNotActivatedException(channel);
    }

    // 1b. Fail loudly if the template lacks the carrier settings needed for
    //     actual delivery (the relay would otherwise accept + the carrier drop).
    if (channel === MessagingChannel.SMS) {
      const missing: string[] = [];
      if (!template.smsTemplateId) missing.push('DLT template id');
      if (!template.smsSenderId) missing.push('sender id');
      if (missing.length) {
        throw new ShareTemplateNotConfiguredException('SMS', missing);
      }
    } else if (channel === MessagingChannel.WHATSAPP) {
      if (!template.smsTemplateId) {
        throw new ShareTemplateNotConfiguredException('WHATSAPP', [
          'approved WhatsApp template id',
        ]);
      }
    }

    // 2. Recipient: explicit override, else the recipient's channel contact.
    const fallback =
      channel === MessagingChannel.EMAIL
        ? recipient.email
        : channel === MessagingChannel.WHATSAPP
          ? recipient.whatsapp
          : recipient.sms; // SMS
    const toAddress = (toAddressOverride ?? '').trim() || (fallback ?? '');
    if (!toAddress) {
      throw new ShareRecipientMissingException(channel);
    }

    // 3. Attach the rendered PDF for Email/WhatsApp (SMS has none).
    let attachments: { data: string; name: string; type: string }[] | undefined;
    if (
      getPdf &&
      (channel === MessagingChannel.EMAIL ||
        channel === MessagingChannel.WHATSAPP)
    ) {
      attachments = await getPdf().then((data) => [
        {
          data,
          name: attachmentName,
          type: 'application/pdf',
        },
      ]);
    }

    // 4. Enqueue — passing `templateId` makes the service pull the body + SMS/
    //    WhatsApp metadata from the activated template. The worker delivers.
    return this.communicationService.enqueue(
      tenantId,
      template.branchId,
      {
        channel,
        templateId: template.id,
        feature,
        recipients: [
          {
            recipientType: recipient.type,
            recipientId: recipient.recipientId ?? undefined,
            recipientName: recipient.recipientName ?? undefined,
            toAddress,
          },
        ],
        attachments,
        variables,
      },
      actorId,
    );
  }

  /**
   * Raise the in-app (IAM) share, using the tenant's ACTIVATED IAM `feature`
   * template for the body (placeholders substituted). Unlike the deliverable
   * channels this doesn't go through the Exchange queue — it creates an in-app
   * notification addressed to `targets` (their notification bell / inbox).
   *
   * @returns the created notification id
   * @throws ShareTemplateNotActivatedException if no activated IAM template
   * @throws ShareRecipientMissingException if there are no targets to notify
   */
  async dispatchIam(
    tenantId: string,
    branchId: string | null,
    feature: string,
    targets: ShareIamTarget[],
    actorId: string,
    variables: Record<string, string>,
    iamConfig: ShareIamConfig,
  ): Promise<string> {
    const template = await this.templateService.resolveActivatedTemplate(
      tenantId,
      branchId,
      MessagingChannel.IAM,
      feature,
    );
    if (!template) {
      throw new ShareTemplateNotActivatedException(MessagingChannel.IAM);
    }
    if (!targets.length) {
      throw new ShareRecipientMissingException(MessagingChannel.IAM);
    }

    const body = this.fillTemplate(template.template, variables);
    const notification = await this.notificationService.create(
      tenantId,
      branchId,
      {
        kind: NotificationKind.ALERT,
        verb: iamConfig.verb,
        subject: template.displayTitle ?? iamConfig.subject,
        body,
        targets: targets.map((t) => ({
          entityId: t.entityId,
          entityType: t.entityType,
          name: t.name ?? undefined,
        })),
      },
      {
        entityId: actorId || 'system',
        entityType: actorId ? (iamConfig.actorEntityType ?? 'USER') : 'SYSTEM',
      },
    );
    return notification.id;
  }

  /**
   * Which of `channels` the tenant has ACTIVATED a `feature` template for, with the
   * default contact per channel (from `contactFor`). Drives a Share popup preload
   * — the UI enables only activated channels and auto-fills recipients.
   */
  async getChannelInfo(
    tenantId: string,
    branchId: string | null,
    feature: string,
    channels: MessagingChannel[],
    contactFor: (channel: MessagingChannel) => string | null,
  ): Promise<ShareChannelInfo[]> {
    return Promise.all(
      channels.map(async (channel) => ({
        channel,
        activated:
          (await this.templateService.resolveActivatedTemplate(
            tenantId,
            branchId,
            channel,
            feature,
          )) !== null,
        toAddress: contactFor(channel),
      })),
    );
  }

  /**
   * Translate a per-channel share failure into a `ShareChannelResult` for a
   * multi-channel ("Send All") share, which never aborts on one channel's failure.
   */
  classifyError(channel: MessagingChannel, err: unknown): ShareChannelResult {
    if (err instanceof ShareTemplateNotActivatedException) {
      return { channel, status: 'SKIPPED', reason: 'No activated template' };
    }
    if (err instanceof ShareRecipientMissingException) {
      return { channel, status: 'SKIPPED', reason: 'No recipient on file' };
    }
    if (err instanceof ShareTemplateNotConfiguredException) {
      return {
        channel,
        status: 'FAILED',
        reason: 'Template missing provider settings',
      };
    }
    const message = err instanceof Error ? err.message : 'Send failed';
    this.logger.error(`Share: ${channel} failed — ${message}`);
    return { channel, status: 'FAILED', reason: message };
  }

  /** Substitute `{key}` placeholders in a template body. */
  fillTemplate(raw: string, vars: Record<string, string>): string {
    let out = raw || '';
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(v ?? '');
    }
    return out;
  }
}
