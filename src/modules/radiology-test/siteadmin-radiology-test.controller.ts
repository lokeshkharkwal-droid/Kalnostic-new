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
import { RadiologyTestService } from './radiology-test.service';
import { CreateRadiologyTestDto } from './dto/create-radiology-test.dto';
import { UpdateRadiologyTestDto } from './dto/update-radiology-test.dto';
import { BrowseRadiologyTestTemplatesDto } from './dto/list-radiology-tests.dto';
import { RadiologyTestOptionsQueryDto } from './dto/radiology-test-options-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin global radiology-test **template** management
 * (`/siteadmin/radiology-tests`). Templates carry `source = SITE_ADMIN` and no
 * tenant/branch/master data — businesses adopt them by cloning.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Template content is
 * master-data content, so reads require `master-data:read` and writes
 * `master-data:write`.
 */
@Controller('siteadmin/radiology-tests')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminRadiologyTestController {
  constructor(private readonly radiologyTestService: RadiologyTestService) {}

  /**
   * Create a global template radiology test.
   */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a template radiology test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateRadiologyTestDto,
  ) {
    return this.radiologyTestService.createTemplate(actorId, dto);
  }

  /**
   * List global template radiology tests.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: BrowseRadiologyTestTemplatesDto) {
    return this.radiologyTestService.findAllTemplates(query);
  }

  /**
   * Lightweight `{ id, name }` options for SITE_ADMIN template radiology tests.
   * Declared before `:id` so `options` isn't matched as an id.
   */
  @Get('options')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOptions(@Query() query: RadiologyTestOptionsQueryDto) {
    return this.radiologyTestService.findTemplateOptions({
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Fetch one global template radiology test with all its children.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.radiologyTestService.findTemplateById(id);
  }

  /**
   * Update a global template radiology test.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Updated a template radiology test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateRadiologyTestDto) {
    return this.radiologyTestService.updateTemplate(id, dto);
  }

  /**
   * Soft-delete a global template radiology test.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Deleted a template radiology test',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.radiologyTestService.removeTemplate(id);
  }
}
