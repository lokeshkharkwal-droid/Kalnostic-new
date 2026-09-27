import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OpdTestService } from './opd-test.service';
import { CreateOpdTestDto } from './dto/create-opd-test.dto';
import { UpdateOpdTestDto } from './dto/update-opd-test.dto';
import { BrowseOpdTestTemplatesDto } from './dto/list-opd-tests.dto';
import { OpdTestOptionsQueryDto } from './dto/opd-test-options-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin global opd-test **template** management
 * (`/siteadmin/opd-tests`). Templates carry `source = SITE_ADMIN` and no
 * tenant/branch/master data — businesses adopt them by cloning.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Template content is
 * master-data content, so reads require `master-data:read` and writes
 * `master-data:write`.
 */
@Controller('siteadmin/opd-tests')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminOpdTestController {
  constructor(private readonly opdTestService: OpdTestService) {}

  /**
   * Create a global template opd test.
   */
  @Post()
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Created a template opd test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateOpdTestDto,
  ) {
    return this.opdTestService.createTemplate(actorId, dto);
  }

  /**
   * List global template opd tests.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: BrowseOpdTestTemplatesDto) {
    return this.opdTestService.findAllTemplates(query);
  }

  /**
   * Lightweight `{ id, name }` options for SITE_ADMIN template opd tests.
   * Declared before `:id` so `options` isn't matched as an id.
   */
  @Get('options')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOptions(@Query() query: OpdTestOptionsQueryDto) {
    return this.opdTestService.findTemplateOptions({
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Fetch one global template opd test with all its children.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.opdTestService.findTemplateById(id);
  }

  /**
   * Update a global template opd test.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a template opd test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateOpdTestDto) {
    return this.opdTestService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template opd test.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Deleted a template opd test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.opdTestService.removeTemplate(id);
  }
}
