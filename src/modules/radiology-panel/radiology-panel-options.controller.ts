import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyPanelService } from './radiology-panel.service';
import { RadiologyPanelOptionsQueryDto } from './dto/radiology-panel-options-query.dto';
import { ListRadiologyPanelsDto } from './dto/list-radiology-panels.dto';
import { CloneRadiologyPanelTemplateDto } from './dto/clone-radiology-panel-template.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat radiology-panel endpoints (`/radiology-panels/...`): the options selector,
 * read-only browsing of SITE_ADMIN templates, and cloning a template into the
 * tenant. Business-authenticated; tenant comes from the JWT.
 */
@Controller('radiology-panels')
export class RadiologyPanelOptionsController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: RadiologyPanelOptionsQueryDto,
  ) {
    return this.radiologyPanelService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template radiology panels (read-only). Declared before
   * `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(@Query() query: ListRadiologyPanelsDto) {
    return this.radiologyPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one SITE_ADMIN template radiology panel with its included tests (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.radiologyPanelService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template radiology panel into the tenant's catalogue.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin radiology panel template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneRadiologyPanelTemplateDto,
  ) {
    return this.radiologyPanelService.cloneToTenant(
      id,
      tenantId,
      dto.masterDataId,
    );
  }
}
