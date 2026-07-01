import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { LabPanelService } from './lab-panel.service';
import { LabPanelOptionsQueryDto } from './dto/lab-panel-options-query.dto';
import { ListLabPanelsDto } from './dto/list-lab-panels.dto';
import { CloneLabPanelTemplateDto } from './dto/clone-lab-panel-template.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat lab-panel endpoints (`/lab-panels/...`), separate from the
 * master-data-nested CRUD controller: the options selector (across a branch, not
 * one master data), read-only browsing of SITE_ADMIN templates, and cloning a
 * template into the tenant. Business-authenticated; tenant comes from the JWT.
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('lab-panels')
export class LabPanelOptionsController {
  constructor(private readonly labPanelService: LabPanelService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to the
   * tenant's active lab panels, optionally by `branchId` and a name `search`.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: LabPanelOptionsQueryDto,
  ) {
    return this.labPanelService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template lab panels (read-only) so the tenant can pick
   * one to clone. Declared before `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(@Query() query: ListLabPanelsDto) {
    return this.labPanelService.findAllTemplates(query);
  }

  /**
   * Fetch one SITE_ADMIN template lab panel with its included tests (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.labPanelService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template lab panel into the tenant's catalogue. `tenantId`
   * comes from the JWT; `branchId` from the target master data; only `masterDataId`
   * is supplied in the body. The template's referenced tests are cloned into the
   * tenant too. Returns the new TENANT lab panel with its tests.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin lab panel template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneLabPanelTemplateDto,
  ) {
    return this.labPanelService.cloneToTenant(id, tenantId, dto.masterDataId);
  }
}
