import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule, NotificationKind } from '@prisma/client';
import { NotificationService, ActorIdentity } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationQueryDto } from './dto/list-notification-query.dto';
import { ReplyNotificationDto } from './dto/reply-notification.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * In-app notification endpoints — the notification bell / inbox. The recipient
 * identity is derived from the JWT (person id + patient/staff context), never
 * from the query/body. Tenant + branch come from the JWT (CLAUDE.md §4.7). The
 * global `JwtAuthGuard` protects all routes.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * List in-app notifications addressed to the caller (paginated; kind/unread
   * filter + search). Response carries an `unread` count for the badge.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationQueryDto,
  ) {
    return this.notificationService.listForRecipient(
      tenantId,
      this.identity(user),
      query,
    );
  }

  /**
   * Convenience listing of system ALERTs addressed to the caller.
   */
  @Get('alerts')
  findAlerts(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationQueryDto,
  ) {
    return this.notificationService.listForRecipient(
      tenantId,
      this.identity(user),
      {
        ...query,
        kind: NotificationKind.ALERT,
      },
    );
  }

  /**
   * Fetch one notification and mark the caller's copy as read.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notificationService.getAndRead(
      tenantId,
      id,
      this.identity(user),
    );
  }

  /**
   * Mark the caller's copy of a notification as read.
   */
  @Post(':id/read')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.UPDATE,
    description: 'Marked a notification read',
  })
  markRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notificationService.markRead(tenantId, id, this.identity(user));
  }

  /**
   * Reply to a message notification (threaded to its root).
   */
  @Post(':id/reply')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Replied to a notification',
  })
  reply(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReplyNotificationDto,
  ) {
    return this.notificationService.reply(
      tenantId,
      profile.branchId,
      id,
      dto.body,
      this.identity(user),
    );
  }

  /**
   * Create an in-app notification (a MESSAGE or ALERT) targeting one or more users.
   */
  @Post()
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Created an in-app notification',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateNotificationDto,
  ) {
    return this.notificationService.create(
      tenantId,
      profile.branchId,
      dto,
      this.identity(user),
    );
  }

  /** Resolve the caller's notification identity from the JWT. */
  private identity(user: JwtPayload): ActorIdentity {
    return {
      entityId: user.person_id,
      entityType: user.is_patient_context ? 'PATIENT' : 'STAFF',
    };
  }
}
