import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { CommunicationService } from './communication.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ListCommunicationQueryDto } from './dto/list-communication-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Outbound messaging endpoints (business-authenticated; tenant + branch come from
 * the JWT, never the body — CLAUDE.md §4.7). A send resolves a template + queues
 * one row per recipient; the background worker delivers via the Exchange gateway.
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('communications')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  /**
   * Compose + queue a message (Email / SMS / WhatsApp) to one or more recipients.
   */
  @Post('send')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.CREATE,
    description: 'Sent a message',
  })
  send(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.communicationService.enqueue(
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /**
   * List the communication log/queue for the caller's tenant (paginated + filters).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListCommunicationQueryDto,
  ) {
    return this.communicationService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one communication log row.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.communicationService.findById(id, tenantId);
  }

  /**
   * Requeue a failed message for another delivery attempt.
   */
  @Post(':id/retry')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.UPDATE,
    description: 'Retried a failed message',
  })
  retry(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.communicationService.retry(id, tenantId, personId);
  }
}
