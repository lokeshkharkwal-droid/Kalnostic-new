import { Injectable } from '@nestjs/common';
import {
  CommunicationLog,
  CommunicationStatus,
  MessagingChannel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { TemplateService } from '../template/template.service';
import {
  ExchangeAttachment,
  ExchangeClient,
  ExchangeResponse,
} from './exchange/exchange.client';
import { SendMessageDto } from './dto/send-message.dto';
import { ListCommunicationQueryDto } from './dto/list-communication-query.dto';
import {
  CommunicationLogNotFoundException,
  InvalidComposePayloadException,
  TemplateResolutionFailedException,
} from './exceptions/communication.exceptions';

/** Channels the Exchange gateway can actually deliver. */
const DELIVERABLE_CHANNELS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
];

/** Channel-specific metadata snapshotted onto the queue row for dispatch. */
interface ExchangeMeta {
  smsTemplateId?: string | null;
  smsSenderId?: string | null;
  smsType?: string | null;
  templateCategory?: string | null;
  messageType?: string | null;
}

/** Shape of the `payload` JSON column on a communication_logs row. */
interface CommunicationPayload {
  attachments?: ExchangeAttachment[];
  exchange?: ExchangeMeta;
  variables?: Record<string, string>;
  /** Ordered WhatsApp approved-template params ({{1}},{{2}}…). */
  templateParams?: string[];
}

/**
 * Outbound-message orchestration: resolve the template, substitute placeholders,
 * enqueue one `CommunicationLog` row per recipient, and dispatch a row to the
 * external Exchange gateway (called by the queue worker). Tenant-scoped +
 * branch-level (CLAUDE.md §4.6/§4.7): every read carries `tenantId` (defence in
 * depth on top of RLS) and filters soft-deleted rows; multi-step writes run
 * inside `withTenant` so the RLS GUC is set.
 */
@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeClient,
    private readonly templateService: TemplateService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve + enqueue a compose/send request as one PENDING queue row per
   * recipient. The body is taken from `body` (free text), else the `templateId`,
   * else resolved from `feature` + channel; placeholders are substituted with the
   * supplied `variables` (plus `{pn}`/`{patient_name}` from each recipient name).
   * The background worker performs actual delivery.
   *
   * @param tenantId owning tenant (from JWT)
   * @param scopeBranchId active branch (branch-admin) or null (business-admin)
   * @param dto validated compose payload (no tenant/branch ids)
   * @param actorId person id of the sender (audit trail)
   * @returns the created queue rows
   * @throws InvalidComposePayloadException if neither body nor template/feature given,
   *   or the channel is not deliverable via Exchange
   * @throws TemplateResolutionFailedException if `feature` resolves to no template
   */
  async enqueue(
    tenantId: string,
    scopeBranchId: string | null,
    dto: SendMessageDto,
    actorId?: string,
  ): Promise<CommunicationLog[]> {
    if (!DELIVERABLE_CHANNELS.includes(dto.channel)) {
      throw new InvalidComposePayloadException(
        `Channel ${dto.channel} is not deliverable via the messaging gateway; use in-app notifications instead`,
      );
    }
    if (scopeBranchId !== null) {
      await this.branchService.findById(scopeBranchId, tenantId);
    }

    // Resolve the raw body + channel metadata (template vs free text).
    const { rawBody, subject, meta, templateId } = await this.resolveBody(
      tenantId,
      scopeBranchId,
      dto,
    );

    const attachments = dto.attachments;
    const scheduledAt = dto.schedule ? new Date(dto.schedule) : null;
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;

    return this.prisma.withTenant(tenantId, (tx) =>
      Promise.all(
        dto.recipients.map((r) => {
          const body = this.fillTemplate(rawBody, {
            ...(dto.variables ?? {}),
            pn: r.recipientName ?? dto.variables?.['pn'] ?? '',
            patient_name:
              r.recipientName ?? dto.variables?.['patient_name'] ?? '',
          });
          const payload: CommunicationPayload = {
            ...(attachments?.length ? { attachments } : {}),
            ...(meta ? { exchange: meta } : {}),
            ...(dto.variables ? { variables: dto.variables } : {}),
            ...(dto.templateParams?.length
              ? { templateParams: dto.templateParams }
              : {}),
          };
          return tx.communicationLog.create({
            data: {
              tenantId,
              branchId: scopeBranchId,
              channel: dto.channel,
              status: CommunicationStatus.PENDING,
              feature: dto.feature ?? null,
              templateId: templateId ?? null,
              recipientType: r.recipientType,
              recipientId: r.recipientId ?? null,
              recipientName: r.recipientName ?? null,
              toAddress: r.toAddress,
              subject: subject ?? null,
              body,
              payload: (payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
              campaign: dto.campaign ?? null,
              scheduledAt,
              expiryDate,
              userTimezone: dto.userTimezone ?? null,
              createdBy: actorId ?? null,
              updatedBy: actorId ?? null,
            },
          });
        }),
      ),
    );
  }

  /**
   * List communication log/queue rows for a tenant (offset pagination), newest
   * first, with optional channel/status/recipientType/feature/campaign, date
   * range, and a free-text `search` over recipient name/address and subject.
   * @param tenantId tenant scope
   * @param query validated filters + pagination
   */
  async findAllForTenant(
    tenantId: string,
    query: ListCommunicationQueryDto,
  ): Promise<PaginatedResult<CommunicationLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.CommunicationLogWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.channel !== undefined) where.channel = query.channel;
    if (query.status !== undefined) where.status = query.status;
    if (query.recipientType !== undefined) {
      where.recipientType = query.recipientType;
    }
    if (query.feature !== undefined) where.feature = query.feature;
    if (query.campaign !== undefined) where.campaign = query.campaign;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { recipientName: { contains: search, mode: 'insensitive' } },
        { toAddress: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }

    const data = await this.prisma.communicationLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.communicationLog.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Fetch one communication log row scoped to its tenant.
   * @param id row id
   * @param tenantId tenant scope
   * @throws CommunicationLogNotFoundException if missing/soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<CommunicationLog> {
    const row = await this.prisma.communicationLog.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new CommunicationLogNotFoundException(id);
    }
    return row;
  }

  /**
   * Requeue a FAILED (or CANCELLED) message: reset it to PENDING and clear the
   * expiry so the worker picks it up again. The retry counter is preserved (the
   * worker still stops at `maxRetry`); resetting `maxRetry`-exceeded rows here is
   * the user's explicit "try again".
   * @param id row id
   * @param tenantId tenant scope
   * @param actorId person id of the retrier (audit trail)
   * @throws CommunicationLogNotFoundException if missing/soft-deleted
   */
  async retry(
    id: string,
    tenantId: string,
    actorId?: string,
  ): Promise<CommunicationLog> {
    const row = await this.findById(id, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.communicationLog.update({
        where: { id: row.id },
        data: {
          status: CommunicationStatus.PENDING,
          statusMessage: null,
          expiryDate: null,
          maxRetry: Math.max(row.maxRetry, row.retry + 1),
          updatedBy: actorId ?? row.updatedBy,
        },
      }),
    );
  }

  /**
   * Deliver a single queue row through the Exchange gateway based on its channel.
   * Pure dispatch — the caller (queue worker) persists the result. Returns the
   * gateway response (or null when unconfigured/errored). Not tenant-transactional
   * itself; the worker wraps state writes in `withTenant`.
   * @param row the PENDING row to send
   */
  async dispatch(row: CommunicationLog): Promise<ExchangeResponse | null> {
    const payload = (row.payload as CommunicationPayload | null) ?? {};
    const meta = payload.exchange ?? {};
    const peer = {
      tenantId: row.tenantId,
      branchId: row.branchId ?? '',
    };
    const reqParams = {
      notification_type: row.feature ?? 'ad_hoc',
      context_id: row.id,
      context_type: 'communication_log',
    };

    switch (row.channel) {
      case MessagingChannel.EMAIL:
        return this.exchange.sendEmail(
          peer,
          {
            to: row.toAddress,
            subject: row.subject ?? '',
            body: row.body,
            attachments: payload.attachments,
          },
          reqParams,
        );
      case MessagingChannel.WHATSAPP:
        return this.exchange.sendWhatsapp(
          peer,
          {
            to: row.toAddress,
            message: row.body,
            smsTemplateId: meta.smsTemplateId ?? undefined,
            smsSenderId: meta.smsSenderId ?? undefined,
            smsType: meta.smsType ?? undefined,
            templateCategory: meta.templateCategory ?? undefined,
            templateParams: payload.templateParams,
            contextName: row.recipientName ?? undefined,
            attachments: payload.attachments,
          },
          reqParams,
        );
      case MessagingChannel.SMS:
        return this.exchange.sendSms(
          peer,
          {
            to: row.toAddress,
            message: row.body,
            smsTemplateId: meta.smsTemplateId ?? undefined,
            smsSenderId: meta.smsSenderId ?? undefined,
            smsType: meta.smsType ?? undefined,
            messageType: meta.messageType ?? undefined,
          },
          reqParams,
        );
      default:
        return null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Resolve the raw (un-substituted) body + subject + channel metadata for a send.
   * Precedence: explicit `body` → `templateId` → `feature`-resolved template.
   * @throws InvalidComposePayloadException if none supplied
   * @throws TemplateResolutionFailedException if a `feature` resolves to nothing
   */
  private async resolveBody(
    tenantId: string,
    scopeBranchId: string | null,
    dto: SendMessageDto,
  ): Promise<{
    rawBody: string;
    subject: string | null;
    meta: ExchangeMeta | null;
    templateId: string | null;
  }> {
    if (dto.body && dto.body.trim()) {
      return {
        rawBody: dto.body,
        subject: dto.subject ?? null,
        meta: null,
        templateId: dto.templateId ?? null,
      };
    }
    if (dto.templateId) {
      const t = await this.templateService.findById(
        dto.templateId,
        tenantId,
        scopeBranchId,
      );
      return {
        rawBody: t.template,
        subject: dto.subject ?? t.displayTitle,
        meta: this.metaFromTemplate(t),
        templateId: t.id,
      };
    }
    if (dto.feature) {
      const t = await this.templateService.resolveForDelivery(
        tenantId,
        scopeBranchId,
        dto.channel,
        dto.feature,
      );
      if (!t) {
        throw new TemplateResolutionFailedException(dto.feature, dto.channel);
      }
      return {
        rawBody: t.template,
        subject: dto.subject ?? t.displayTitle,
        meta: this.metaFromTemplate(t),
        templateId: t.id,
      };
    }
    throw new InvalidComposePayloadException(
      'Provide a message body, a templateId, or a feature to resolve a template',
    );
  }

  /** Extract the SMS/WhatsApp gateway metadata from a resolved template. */
  private metaFromTemplate(t: {
    smsTemplateId: string | null;
    smsSenderId: string | null;
    smsType: string | null;
    templateCategory: string | null;
  }): ExchangeMeta {
    return {
      smsTemplateId: t.smsTemplateId,
      smsSenderId: t.smsSenderId,
      smsType: t.smsType,
      templateCategory: t.templateCategory,
    };
  }

  /**
   * Substitute `{key}` placeholders in `raw` with the supplied values (simple
   * string replace, ports Kishan's `fillTemplate`). Unmatched placeholders are
   * left untouched.
   * @param raw the template body with `{placeholder}` tokens
   * @param vars key → value substitution map (keys WITHOUT braces)
   */
  private fillTemplate(raw: string, vars: Record<string, string>): string {
    let out = raw || '';
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(v ?? '');
    }
    return out;
  }
}
