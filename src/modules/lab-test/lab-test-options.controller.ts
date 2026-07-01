import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { LabTestService } from './lab-test.service';
import { LabTestOptionsQueryDto } from './dto/lab-test-options-query.dto';
import { ListLabTestsDto } from './dto/list-lab-tests.dto';
import { CloneLabTestTemplateDto } from './dto/clone-lab-test-template.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Flat lab-test endpoints (`/lab-tests/...`), separate from the master-data-nested
 * CRUD controller: the options selector (across a branch, not one master data),
 * read-only browsing of SITE_ADMIN templates, and cloning a template into the
 * tenant. Business-authenticated; tenant comes from the JWT. The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('lab-tests')
export class LabTestOptionsController {
  constructor(private readonly labTestService: LabTestService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable selector. Filters to the
   * tenant's active lab tests, optionally by `branchId` and a name `search`.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: LabTestOptionsQueryDto,
  ) {
    return this.labTestService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Browse SITE_ADMIN global template lab tests (read-only) so the tenant can pick
   * one to clone. Declared before `:id` routes so `templates` isn't matched as an id.
   */
  @Get('templates')
  findTemplates(@Query() query: ListLabTestsDto) {
    return this.labTestService.findAllTemplates(query);
  }

  /**
   * Fetch one SITE_ADMIN template lab test with its children (read-only).
   */
  @Get('templates/:id')
  findTemplate(@Param('id') id: string) {
    return this.labTestService.findTemplateById(id);
  }

  /**
   * Clone a SITE_ADMIN template lab test into the tenant's catalogue. `tenantId`
   * comes from the JWT; `branchId` from the target master data; only `masterDataId`
   * is supplied in the body. Returns the new TENANT lab test with children.
   */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Cloned a Site Admin lab test template into the tenant',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloneLabTestTemplateDto,
  ) {
    return this.labTestService.cloneToTenant(id, tenantId, dto.masterDataId);
  }
}
