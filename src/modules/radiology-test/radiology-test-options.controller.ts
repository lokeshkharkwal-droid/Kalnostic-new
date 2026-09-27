import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyTestService } from './radiology-test.service';
import { RadiologyTestOptionsQueryDto } from './dto/radiology-test-options-query.dto';
import { BrowseRadiologyTestTemplatesDto } from './dto/list-radiology-tests.dto';
import { CloneRadiologyTestTemplateDto } from './dto/clone-radiology-test-template.dto';
import { ImportRadiologyTestTemplatesDto } from './dto/import-radiology-test-templates.dto';
import { SyncRadiologyTestTemplatesDto } from './dto/sync-radiology-test-templates.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat radiology-test endpoints (`/radiology-tests/...`): the options selector
 * (across a branch), read-only browsing of SITE_ADMIN templates, cloning a
 * template into the tenant, and bulk import/sync. Business-authenticated; tenant
 * comes from the JWT.
 */
@Controller('radiology-tests')
export class RadiologyTestOptionsController {
  constructor(private readonly radiologyTestService: RadiologyTestService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: RadiologyTestOptionsQueryDto,
  ) {
    return this.radiologyTestService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template radiology tests (read-only). Declared before
   * `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(
    @CurrentTenant() tenantId: string,
    @Query() query: BrowseRadiologyTestTemplatesDto,
  ) {
    return this.radiologyTestService.findAllTemplates(query, tenantId);
  }

  /**
   * Fetch one SITE_ADMIN template radiology test with its children (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.radiologyTestService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template radiology test into the tenant's catalogue.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin radiology test template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneRadiologyTestTemplateDto,
  ) {
    return this.radiologyTestService.cloneToTenant(
      id,
      tenantId,
      dto.masterDataId,
    );
  }

  /**
   * Bulk-import SITE_ADMIN template radiology tests into the tenant's master data.
   */
  @Post('import')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Imported Site Admin radiology-test templates into the tenant',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportRadiologyTestTemplatesDto,
  ) {
    return this.radiologyTestService.importTemplates(tenantId, personId, dto);
  }

  /**
   * Re-pull previously-imported radiology tests from their SITE_ADMIN templates.
   */
  @Post('sync')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Synced imported radiology tests from Site Admin',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncRadiologyTestTemplatesDto,
  ) {
    return this.radiologyTestService.syncTemplates(tenantId, personId, dto);
  }
}
