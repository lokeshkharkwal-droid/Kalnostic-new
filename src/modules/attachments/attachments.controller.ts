import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AttachmentsService } from './attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { ListAttachmentsQueryDto } from './dto/list-attachments-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Generic attachment endpoints. Business-authenticated (global `JwtAuthGuard`);
 * tenant + active branch come from the JWT. Any feature attaches a
 * previously-uploaded file (its S3 URL) to one of its records via
 * (`entityType`, `entityId`) — no per-feature table needed.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  /** Attach an uploaded file (S3 URL + metadata) to an owner record. */
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.attachmentsService.create(
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** List active attachments for one owner record. */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListAttachmentsQueryDto,
  ) {
    return this.attachmentsService.findForEntity(
      tenantId,
      query.entityType,
      query.entityId,
      query.category,
    );
  }

  /** Soft-delete an attachment. */
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.attachmentsService.remove(id, tenantId);
  }
}
