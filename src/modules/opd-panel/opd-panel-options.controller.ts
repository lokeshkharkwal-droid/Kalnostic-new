import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { OpdPanelService } from './opd-panel.service';
import { OpdPanelOptionsQueryDto } from './dto/opd-panel-options-query.dto';
import { ListOpdPanelsDto } from './dto/list-opd-panels.dto';
import { CloneOpdPanelTemplateDto } from './dto/clone-opd-panel-template.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat opd-panel endpoints (`/opd-panels/...`): the options selector,
 * read-only browsing of SITE_ADMIN templates, and cloning a template into the
 * tenant. Business-authenticated; tenant comes from the JWT.
 */
@Controller('opd-panels')
export class OpdPanelOptionsController {
  constructor(private readonly opdPanelService: OpdPanelService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: OpdPanelOptionsQueryDto,
  ) {
    return this.opdPanelService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template opd panels (read-only). Declared before
   * `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(@Query() query: ListOpdPanelsDto) {
    return this.opdPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one SITE_ADMIN template opd panel with its included tests (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.opdPanelService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template opd panel into the tenant's catalogue.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin opd panel template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneOpdPanelTemplateDto,
  ) {
    return this.opdPanelService.cloneToTenant(id, tenantId, dto.masterDataId);
  }
}
