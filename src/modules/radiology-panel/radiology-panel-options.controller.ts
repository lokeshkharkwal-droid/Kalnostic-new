import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyPanelService } from './radiology-panel.service';
import { RadiologyPanelOptionsQueryDto } from './dto/radiology-panel-options-query.dto';
import { BrowseRadiologyPanelTemplatesDto } from './dto/list-radiology-panels.dto';
import { CloneRadiologyPanelTemplateDto } from './dto/clone-radiology-panel-template.dto';
import { ImportRadiologyPanelTemplatesDto } from './dto/import-radiology-panel-templates.dto';
import { SyncRadiologyPanelTemplatesDto } from './dto/sync-radiology-panel-templates.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat radiology-panel endpoints (`/radiology-panels/...`), separate from the
 * master-data-nested CRUD controller: the options selector (across a branch, not
 * one master data), read-only browsing of SITE_ADMIN templates, and cloning/
 * importing/syncing templates into the tenant. Business-authenticated; tenant
 * comes from the JWT. The global `JwtAuthGuard` protects all routes.
 */
@Controller('radiology-panels')
export class RadiologyPanelOptionsController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to the
   * tenant's active radiology panels, optionally by `branchId` and a name
   * `search`. Returns the full array when `page` is omitted, or a paginated
   * envelope when `page` is supplied.
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
   * Browse SITE_ADMIN global template radiology panels (read-only) so the tenant
   * can pick one to clone. Declared before `:id` routes so `templates` isn't
   * matched as an id. When `masterDataId` is supplied, each row is annotated with
   * `isImported` (and `notImportedOnly=true` hides templates already imported).
   */
  @Get('templates')
  findTemplates(
    @CurrentTenant() tenantId: string,
    @Query() query: BrowseRadiologyPanelTemplatesDto,
  ) {
    return this.radiologyPanelService.findAllTemplates(query, tenantId);
  }

  /**
   * Fetch one SITE_ADMIN template radiology panel with its included tests
   * (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.radiologyPanelService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template radiology panel into the tenant's catalogue.
   * `tenantId` comes from the JWT; `branchId` from the target master data; only
   * `masterDataId` is supplied in the body. The template's referenced tests are
   * cloned into the tenant too. Returns the new TENANT radiology panel with its
   * tests.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.LAB_PANEL,
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

  /**
   * Bulk-import SITE_ADMIN template radiology panels into the tenant's master
   * data. Each template is imported independently; already-imported templates are
   * skipped and name/code conflicts are reported. Returns an
   * `{ imported, skipped, failed }` summary.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description:
      'Imported Site Admin radiology-panel templates into the tenant',
  })
  import(
    @CurrentTenant() tenantId: string,
    @Body() dto: ImportRadiologyPanelTemplatesDto,
  ) {
    return this.radiologyPanelService.importTemplates(tenantId, dto);
  }

  /**
   * Re-pull previously-imported radiology panels from their SITE_ADMIN templates
   * (full overwrite of the tenant copy + member rebuild; hand-created panels are
   * untouched). When `radiologyPanelIds` is omitted, every imported panel in the
   * master data is synced. Returns a `{ synced, skipped, failed }` summary.
   */
  @Post('sync')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Synced imported radiology panels from Site Admin',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @Body() dto: SyncRadiologyPanelTemplatesDto,
  ) {
    return this.radiologyPanelService.syncTemplates(tenantId, dto);
  }
}
