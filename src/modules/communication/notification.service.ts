import { Injectable } from '@nestjs/common';
import { Notification, NotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationQueryDto } from './dto/list-notification-query.dto';
import { NotificationNotFoundException } from './exceptions/communication.exceptions';

/** A notification enriched with the caller's read state + its actors. */
export type NotificationWithContext = Prisma.NotificationGetPayload<{
  include: { actors: true; targets: true };
}>;

/** The sender identity resolved from the JWT (person id + logical type). */
export interface ActorIdentity {
  entityId: string;
  entityType: string;
  name?: string | null;
}

/**
 * In-app notification management (ported from Kishan's `messaging` module, but
 * Prisma-typed and tenant-scoped). Backs the notification bell / inbox: MESSAGE
 * notifications are conversational (targets can reply, threaded via `contextId`),
 * ALERT notifications are system-generated. Tenant-scoped + branch-level; every
 * read carries `tenantId` and multi-step writes run inside `withTenant`.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an in-app notification with its actor (sender) and targets (recipients)
   * in one tenant transaction.
   * @param tenantId owning tenant (from JWT)
   * @param scopeBranchId active branch, or null
   * @param dto validated notification payload
   * @param actor the sender identity (from JWT)
   * @returns the created notification with actors + targets
   */
  async create(
    tenantId: string,
    scopeBranchId: string | null,
    dto: CreateNotificationDto,
    actor: ActorIdentity,
  ): Promise<NotificationWithContext> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.notification.create({
        data: {
          tenantId,
          branchId: scopeBranchId,
          kind: dto.kind,
          verb: dto.verb,
          subject: dto.subject ?? null,
          body: dto.body,
          contextId: dto.contextId ?? null,
          contextType: dto.contextType ?? null,
          actors: {
            create: {
              tenantId,
              entityId: actor.entityId,
              entityType: actor.entityType,
              name: actor.name ?? null,
            },
          },
          targets: {
            create: dto.targets.map((t) => ({
              tenantId,
              entityId: t.entityId,
              entityType: t.entityType,
              name: t.name ?? null,
            })),
          },
        },
        include: { actors: true, targets: true },
      }),
    );
  }

  /**
   * List notifications addressed to the caller (offset pagination), newest first,
   * with an optional kind/unread filter and a free-text `search` over subject/body.
   * @param tenantId tenant scope
   * @param recipient the caller's identity (from JWT)
   * @param query validated filters + pagination
   */
  async listForRecipient(
    tenantId: string,
    recipient: ActorIdentity,
    query: ListNotificationQueryDto,
  ): Promise<PaginatedResult<NotificationWithContext> & { unread: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const targetMatch: Prisma.NotificationTargetWhereInput = {
      tenantId,
      entityId: recipient.entityId,
      entityType: recipient.entityType,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      deletedAt: null,
      targets: { some: targetMatch },
    };
    if (query.kind !== undefined) where.kind = query.kind;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ];
    }

    const data = await this.prisma.notification.findMany({
      where,
      include: { actors: true, targets: true },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.notification.count({ where });
    const unread = await this.prisma.notificationTarget.count({
      where: {
        tenantId,
        entityId: recipient.entityId,
        entityType: recipient.entityType,
        isRead: false,
        notification: { deletedAt: null },
      },
    });
    return { data, total, page, limit, unread };
  }

  /**
   * Fetch one notification addressed to the caller and mark the caller's target
   * as read (so opening it clears the unread badge).
   * @param tenantId tenant scope
   * @param id notification id
   * @param recipient the caller's identity (from JWT)
   * @throws NotificationNotFoundException if missing or not addressed to the caller
   */
  async getAndRead(
    tenantId: string,
    id: string,
    recipient: ActorIdentity,
  ): Promise<NotificationWithContext> {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        targets: {
          some: {
            entityId: recipient.entityId,
            entityType: recipient.entityType,
          },
        },
      },
      include: { actors: true, targets: true },
    });
    if (!notification) {
      throw new NotificationNotFoundException(id);
    }
    await this.markRead(tenantId, id, recipient);
    return notification;
  }

  /**
   * Mark the caller's target row(s) for a notification as read.
   * @param tenantId tenant scope
   * @param id notification id
   * @param recipient the caller's identity (from JWT)
   * @returns the number of target rows updated
   */
  async markRead(
    tenantId: string,
    id: string,
    recipient: ActorIdentity,
  ): Promise<number> {
    const { count } = await this.prisma.withTenant(tenantId, (tx) =>
      tx.notificationTarget.updateMany({
        where: {
          tenantId,
          notificationId: id,
          entityId: recipient.entityId,
          entityType: recipient.entityType,
          isRead: false,
        },
        data: { isRead: true, readAt: new Date() },
      }),
    );
    return count;
  }

  /**
   * Reply to a MESSAGE notification: create a new MESSAGE threaded to the root
   * (`contextId`) that targets the original notification's actors (the senders).
   * @param tenantId tenant scope
   * @param scopeBranchId active branch, or null
   * @param id the notification being replied to
   * @param body the reply text
   * @param actor the replying caller's identity (from JWT)
   * @throws NotificationNotFoundException if the parent is missing/not visible
   */
  async reply(
    tenantId: string,
    scopeBranchId: string | null,
    id: string,
    body: string,
    actor: ActorIdentity,
  ): Promise<NotificationWithContext> {
    const parent = await this.prisma.notification.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { actors: true },
    });
    if (!parent) {
      throw new NotificationNotFoundException(id);
    }
    const targets = parent.actors.map((a) => ({
      entityId: a.entityId,
      entityType: a.entityType,
      name: a.name ?? undefined,
    }));
    return this.create(
      tenantId,
      scopeBranchId,
      {
        kind: NotificationKind.MESSAGE,
        verb: 'reply_message',
        body,
        contextId: parent.contextId ?? parent.id,
        contextType: 'notification',
        targets: targets.length
          ? targets
          : [{ entityId: actor.entityId, entityType: actor.entityType }],
      },
      actor,
    );
  }

  /**
   * Fetch one notification scoped to its tenant (no read side effect).
   * @param tenantId tenant scope
   * @param id notification id
   * @throws NotificationNotFoundException if missing/soft-deleted
   */
  async findById(tenantId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new NotificationNotFoundException(id);
    }
    return row;
  }
}
