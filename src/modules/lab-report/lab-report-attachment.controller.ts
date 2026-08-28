import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { LabReportAttachmentService } from './lab-report-attachment.service';
import { CreateLabReportAttachmentDto } from './dto/create-lab-report-attachment.dto';

/**
 * Technician Reporting attachments (LABORATORY.docx §4.4) — the Image/Doc/File
 * uploads in the result-entry modal. Business-authenticated; tenant + active
 * branch come from the JWT. `GET` is open (a view); create/delete are gated on
 * the same technician-notes permission (the same modal). Listing includes the
 * analyzer histogram images the EMI submit flow attaches.
 */
@Controller('lab-reports')
@UseGuards(PermissionGuard)
export class LabReportAttachmentController {
  constructor(private readonly service: LabReportAttachmentService) {}

  @Get(':id/attachments')
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.listForReport(id, tenantId, profile.branchId);
  }

  @Post(':id/attachments')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_TECH_NOTES)
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.CREATE,
    description: 'Added a lab report attachment',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CreateLabReportAttachmentDto,
  ) {
    return this.service.addAttachment(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_TECH_NOTES)
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.DELETE,
    description: 'Removed a lab report attachment',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.service.remove(id, attachmentId, tenantId, profile.branchId);
  }
}
