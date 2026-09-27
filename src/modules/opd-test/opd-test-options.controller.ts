import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { OpdTestService } from './opd-test.service';
import { OpdTestOptionsQueryDto } from './dto/opd-test-options-query.dto';
import { BrowseOpdTestTemplatesDto } from './dto/list-opd-tests.dto';
import { CloneOpdTestTemplateDto } from './dto/clone-opd-test-template.dto';
import { ImportOpdTestTemplatesDto } from './dto/import-opd-test-templates.dto';
import { SyncOpdTestTemplatesDto } from './dto/sync-opd-test-templates.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat opd-test endpoints (`/opd-tests/...`): the options selector
 * (across a branch), read-only browsing of SITE_ADMIN templates, cloning a
 * template into the tenant, and bulk import/sync. Business-authenticated; tenant
 * comes from the JWT.
 */
@Controller('opd-tests')
export class OpdTestOptionsController {
  constructor(private readonly opdTestService: OpdTestService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: OpdTestOptionsQueryDto,
  ) {
    return this.opdTestService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template opd tests (read-only). Declared before
   * `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(
    @CurrentTenant() tenantId: string,
    @Query() query: BrowseOpdTestTemplatesDto,
  ) {
    return this.opdTestService.findAllTemplates(query, tenantId);
  }

  /**
   * Fetch one SITE_ADMIN template opd test with its children (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.opdTestService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template opd test into the tenant's catalogue.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin opd test template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneOpdTestTemplateDto,
  ) {
    return this.opdTestService.cloneToTenant(id, tenantId, dto.masterDataId);
  }

  /**
   * Bulk-import SITE_ADMIN template opd tests into the tenant's master data.
   */
  @Post('import')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Imported Site Admin opd-test templates into the tenant',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportOpdTestTemplatesDto,
  ) {
    return this.opdTestService.importTemplates(tenantId, personId, dto);
  }

  /**
   * Re-pull previously-imported opd tests from their SITE_ADMIN templates.
   */
  @Post('sync')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Synced imported opd tests from Site Admin',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncOpdTestTemplatesDto,
  ) {
    return this.opdTestService.syncTemplates(tenantId, personId, dto);
  }
}
