import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PdfTemplateConfigService } from './pdf-template-config.service';
import { SavePdfTemplateConfigDto } from './dto/save-pdf-template-config.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * The "Configuration" screen: a tenant's chosen DEFAULT PDF report template per
 * document slot. Business-authenticated; tenant + active branch come from the
 * JWT (`@CurrentProfile().branchId` is null for the tenant-wide config
 * business-admin edits, the active branch for a branch-admin override), never
 * the body (§4.7).
 *
 * Registered BEFORE `PdfReportTemplateController` in the module so the literal
 * `config` / `config/slots` segments are matched here and not captured by that
 * controller's `GET /:id`.
 */
@Controller('pdf-report-templates')
export class PdfTemplateConfigController {
  constructor(private readonly service: PdfTemplateConfigService) {}

  /**
   * The grouped slot catalogue (labels + keys) for the Configuration UI.
   * Declared before `config` so `config/slots` isn't captured as the map route.
   */
  @Get('config/slots')
  slots() {
    return this.service.getSlots();
  }

  /**
   * The caller's current slot → template map.
   */
  @Get('config')
  getConfig(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.service.getConfig(tenantId, profile.branchId);
  }

  /**
   * Upsert the caller's slot → template assignments.
   */
  @Put('config')
  @Audit({
    module: AuditModule.PDF_REPORT_TEMPLATE,
    action: AuditAction.UPDATE,
    description: 'Updated the PDF report template configuration',
  })
  saveConfig(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SavePdfTemplateConfigDto,
  ) {
    return this.service.saveConfig(tenantId, profile.branchId, dto, personId);
  }
}
