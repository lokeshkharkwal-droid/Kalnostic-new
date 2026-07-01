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
import { TestGroupService } from './test-group.service';
import { CreateTestGroupDto } from './dto/create-test-group.dto';
import { UpdateTestGroupDto } from './dto/update-test-group.dto';
import { ListTestGroupsDto } from './dto/list-test-groups.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { CurrentSiteAdmin } from '../siteadmin/decorators/current-siteadmin.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin test-group management (`/siteadmin/test-groups`). A test group is a
 * platform-level, named bundle of SITE_ADMIN lab-test templates (no tenant).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `master-data:read`, writes `master-data:write` (content_admin and above).
 */
@Controller('siteadmin/test-groups')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminTestGroupController {
  constructor(private readonly testGroupService: TestGroupService) {}

  /**
   * Create a test group with its selected lab tests.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  create(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Body() dto: CreateTestGroupDto,
  ) {
    return this.testGroupService.create(actorId, dto);
  }

  /**
   * List test groups (paginated; search by group name). Each row carries the
   * total number of mapped lab tests.
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findAll(@Query() query: ListTestGroupsDto) {
    return this.testGroupService.findAll(query);
  }

  /**
   * Fetch one test group with all its mapped lab tests.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_READ)
  findOne(@Param('id') id: string) {
    return this.testGroupService.findById(id);
  }

  /**
   * Update a test group (mapped lab tests replaced when `labTestIds` provided).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  update(
    @CurrentSiteAdmin('siteadmin_id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTestGroupDto,
  ) {
    return this.testGroupService.update(id, actorId, dto);
  }

  /**
   * Soft-delete a test group (cascade soft-delete of all its lab-test mappings).
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  remove(@Param('id') id: string) {
    return this.testGroupService.remove(id);
  }
}
